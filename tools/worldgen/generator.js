// @ts-check
/**
 * AK-1835-1903 World Generator
 * Fetches Wikipedia subset via BFS from seed page
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const SEED_TITLE = "History of science";
const MAX_PAGES_LIMIT = process.argv.includes("--small")
  ? 20
  : process.argv.includes("--test")
    ? 1
    : 1500;
const MAX_PAGES = MAX_PAGES_LIMIT;
const MIN_DELAY_MS = 1000; // ≥1s between API requests
const USER_AGENT = "AK-1835-1903-worldgen/0.1 (https://github.com/DeeOneXM)";
const CACHE_DIR = path.join(__dirname, "../../world/raw");
const OUTPUT_DIR = path.join(__dirname, "../../world");

/** @type {Map<string, Object>} */
const pages = new Map();
/** @type {Set<string>} */
const visited = new Set();
/** @type {Array<string>} */
const queue = [];
let requestCount = 0;
let lastRequestTime = 0;
const MAX_RETRIES = 5;

/**
 * Sleep for ms milliseconds
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single HTTP GET to Wikipedia API (no retry)
 * @param {string} params - URL query string
 * @returns {Promise<{status: number, body: Object}>}
 */
function httpGetOnce(params) {
  return new Promise((resolve, reject) => {
    const url = `https://en.wikipedia.org/w/api.php?${params}&format=json&maxlag=5`;
    const options = {
      headers: {
        "User-Agent": USER_AGENT,
      },
    };

    const req = https.get(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`JSON parse failed: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

/**
 * Make rate-limited HTTP request to Wikipedia API with exponential backoff retry.
 * Retries on: network error, timeout, HTTP 5xx, and maxlag error responses.
 * @param {string} params - URL query string
 * @returns {Promise<Object>}
 */
async function fetchWikipedia(params) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_DELAY_MS) {
      await sleep(MIN_DELAY_MS - timeSinceLastRequest);
    }

    try {
      const { status, body } = await httpGetOnce(params);
      lastRequestTime = Date.now();
      requestCount++;

      const isMaxlag = body.error && body.error.code === "maxlag";
      if (status >= 500 || isMaxlag) {
        if (attempt === MAX_RETRIES) {
          throw new Error(
            `Max retries exceeded (status=${status}, maxlag=${isMaxlag})`
          );
        }
        const backoffMs = Math.min(1000 * 2 ** attempt, 60000);
        console.warn(
          `  retry ${attempt + 1}/${MAX_RETRIES} after ${backoffMs}ms (status=${status}, maxlag=${isMaxlag})`
        );
        await sleep(backoffMs);
        continue;
      }

      return body;
    } catch (e) {
      lastRequestTime = Date.now();
      requestCount++;
      if (attempt === MAX_RETRIES) {
        throw e;
      }
      const backoffMs = Math.min(1000 * 2 ** attempt, 60000);
      console.warn(
        `  retry ${attempt + 1}/${MAX_RETRIES} after ${backoffMs}ms (${e.message})`
      );
      await sleep(backoffMs);
    }
  }
  throw new Error("unreachable");
}

/**
 * Fetch page details: text, URL, revision ID, categories, links
 * @param {string} title
 * @returns {Promise<Object|null>}
 */
async function fetchPageDetails(title) {
  try {
    const params = new URLSearchParams({
      action: "query",
      titles: title,
      prop: "extracts|info|revisions|categories|links",
      explaintext: "true",
      inprop: "url",
      exlimit: "1",
      exintro: "true",
      rvprop: "ids",
      cllimit: "max",
      clshow: "!hidden",
      pllimit: "max",
      exsectionformat: "plain",
    });

    const result = await fetchWikipedia(params.toString());

    if (!result.query || !result.query.pages) return null;

    const pages = Object.values(result.query.pages);
    if (pages.length === 0) return null;

    const page = pages[0];

    // MediaWiki marks missing pages with missing:"" (empty string, falsy in JS) —
    // must check presence via !==undefined, not truthiness.
    if (page.missing !== undefined || page.ns !== 0) return null;

    return {
      pageId: page.pageid,
      title: page.title,
      url: page.canonicalurl || "",
      revisionId:
        page.lastrevid ||
        (page.revisions && page.revisions[0]
          ? page.revisions[0].revid
          : null),
      text: page.extract || "",
      categories: (page.categories || []).map((c) => c.title),
      links: (page.links || [])
        .filter((l) => l.ns === 0)
        .map((l) => l.title),
    };
  } catch (e) {
    console.error(`Error fetching ${title}: ${e.message}`);
    return null;
  }
}

/**
 * Load checkpoint if exists
 */
function loadCheckpoint() {
  const checkpointFile = path.join(CACHE_DIR, "checkpoint.json");
  if (fs.existsSync(checkpointFile)) {
    try {
      const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, "utf-8"));
      return checkpoint;
    } catch (e) {
      console.warn(`Failed to load checkpoint: ${e.message}`);
    }
  }
  return null;
}

/**
 * Save checkpoint
 */
function saveCheckpoint() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  const checkpoint = {
    timestamp: new Date().toISOString(),
    pagesCount: pages.size,
    visitedCount: visited.size,
    queueLength: queue.length,
    requestCount,
    pages: Array.from(pages.entries()).reduce(
      (acc, [title, data]) => {
        acc[title] = data;
        return acc;
      },
      {}
    ),
    visited: Array.from(visited),
    queue,
  };
  fs.writeFileSync(
    path.join(CACHE_DIR, "checkpoint.json"),
    JSON.stringify(checkpoint, null, 2)
  );
}

/**
 * Main BFS loop
 */
async function generateWorld() {
  console.log(`Starting world generation from seed: "${SEED_TITLE}"`);

  // Try to resume from checkpoint
  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    console.log(`Resuming from checkpoint: ${checkpoint.pagesCount} pages`);
    Object.entries(checkpoint.pages).forEach(([title, data]) => {
      pages.set(title, data);
    });
    checkpoint.visited.forEach((v) => visited.add(v));
    queue.push(...checkpoint.queue);
    requestCount = checkpoint.requestCount;
  } else {
    queue.push(SEED_TITLE);
  }

  // BFS
  while (queue.length > 0 && pages.size < MAX_PAGES) {
    const title = queue.shift();

    if (visited.has(title)) continue;
    visited.add(title);

    console.log(
      `[${pages.size}/${MAX_PAGES}] Fetching: ${title} (queue: ${queue.length})`
    );

    const pageData = await fetchPageDetails(title);
    if (!pageData) {
      console.log(`  -> Skipped (missing/redirect)`);
      continue;
    }

    pages.set(title, pageData);

    // Add unvisited links to queue
    for (const linkTitle of pageData.links) {
      if (!visited.has(linkTitle) && !queue.includes(linkTitle)) {
        queue.push(linkTitle);
        if (queue.length + pages.size >= MAX_PAGES * 1.5) {
          // Limit queue to avoid memory bloat
          queue.length = Math.min(queue.length, 500);
        }
      }
    }

    // Save checkpoint every 100 pages
    if (pages.size % 100 === 0) {
      saveCheckpoint();
      console.log(`  -> Checkpoint saved (${pages.size} pages, ${requestCount} requests)`);
    }
  }

  console.log(`\nFetch complete: ${pages.size} pages, ${requestCount} requests`);
}

/**
 * Compute statistics
 */
function computeStats() {
  const pageList = Array.from(pages.values());
  const pageCount = pageList.length;

  // Build adjacency for degree calculation
  const outDegree = {};
  const inDegree = {};
  const pagesByTitle = {};

  pageList.forEach((page) => {
    pagesByTitle[page.title] = page;
    outDegree[page.title] = page.links.filter(
      (l) => pages.has(l)
    ).length;
    inDegree[page.title] = 0;
  });

  // Count in-degree
  pageList.forEach((page) => {
    page.links.forEach((link) => {
      if (inDegree[link] !== undefined) {
        inDegree[link]++;
      }
    });
  });

  // Find pages with no outgoing links
  const isolated = pageList.filter((p) => outDegree[p.title] === 0).length;

  // Find largest connected component (union-find)
  const parent = {};
  const find = (x) => {
    if (parent[x] !== x) {
      parent[x] = find(parent[x]);
    }
    return parent[x];
  };
  const union = (x, y) => {
    const px = find(x);
    const py = find(y);
    if (px !== py) {
      parent[py] = px;
    }
  };

  pageList.forEach((p) => {
    parent[p.title] = p.title;
  });

  pageList.forEach((page) => {
    page.links.forEach((link) => {
      if (pages.has(link)) {
        union(page.title, link);
      }
    });
  });

  const components = {};
  pageList.forEach((p) => {
    const root = find(p.title);
    components[root] = (components[root] || 0) + 1;
  });

  const largestComponent = Math.max(...Object.values(components));

  // Sample 10 random shortest paths
  const randomPaths = [];
  for (let i = 0; i < 10; i++) {
    const startIdx = Math.floor(Math.random() * pageCount);
    const endIdx = Math.floor(Math.random() * pageCount);
    if (startIdx === endIdx) {
      randomPaths.push(0);
      continue;
    }

    // Simple BFS for shortest path
    const start = pageList[startIdx].title;
    const end = pageList[endIdx].title;
    const dist = {};
    const q = [start];
    dist[start] = 0;

    let found = false;
    while (q.length > 0 && !found) {
      const u = q.shift();
      if (u === end) {
        found = true;
        randomPaths.push(dist[end]);
        break;
      }
      const page = pagesByTitle[u];
      if (!page) continue;
      page.links.forEach((v) => {
        if (pages.has(v) && dist[v] === undefined) {
          dist[v] = dist[u] + 1;
          q.push(v);
        }
      });
    }

    if (!found) {
      randomPaths.push(-1); // unreachable
    }
  }

  const avgDegree =
    Object.values(outDegree).reduce((a, b) => a + b, 0) / pageCount;

  return {
    pageCount,
    avgOutDegree: avgDegree.toFixed(2),
    isolatedPages: isolated,
    largestComponent,
    largestComponentPercent: ((largestComponent / pageCount) * 100).toFixed(1),
    samplePathLengths: randomPaths.filter((p) => p >= 0),
  };
}

/**
 * Write output files
 */
function writeOutput() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // SPEC §3: "alt küme içindeki giden bağlantılar" — links must be
  // restricted to pages that are actually part of the final subset.
  const pageList = Array.from(pages.values()).map((page) => ({
    ...page,
    links: page.links.filter((l) => pages.has(l)),
  }));

  // world.json
  const worldJson = {
    metadata: {
      seed: SEED_TITLE,
      generated: new Date().toISOString(),
      pageCount: pageList.length,
    },
    pages: pageList,
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "world.json"),
    JSON.stringify(worldJson, null, 2)
  );
  console.log(`✓ world/world.json (${pageList.length} pages)`);

  // stats.json
  const stats = computeStats();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "stats.json"),
    JSON.stringify(stats, null, 2)
  );
  console.log(`✓ world/stats.json`);
  console.log(`\nWorld Statistics:`);
  console.log(`  Pages: ${stats.pageCount}`);
  console.log(`  Avg out-degree: ${stats.avgOutDegree}`);
  console.log(`  Isolated pages: ${stats.isolatedPages}`);
  console.log(`  Largest component: ${stats.largestComponent} (${stats.largestComponentPercent}%)`);
  if (stats.largestComponentPercent < 90) {
    console.warn(
      `⚠ WARNING: Largest component is <90%. World may not be fully connected.`
    );
  }
}

/**
 * Entry point
 */
async function main() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    // Small test run if --test flag
    if (process.argv.includes("--test")) {
      const testTitle = "History of science";
      console.log(`\n--- TEST RUN: Fetching seed page only ---`);
      const pageData = await fetchPageDetails(testTitle);
      if (pageData) {
        pages.set(testTitle, pageData);
        console.log(`✓ Test fetch successful: ${pageData.title}`);
        console.log(`  Links found: ${pageData.links.length}`);
        console.log(`  Categories: ${pageData.categories.length}`);
      }
    } else {
      await generateWorld();
    }

    saveCheckpoint();
    writeOutput();
  } catch (err) {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
