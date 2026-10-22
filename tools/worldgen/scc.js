// @ts-check
/**
 * AK-1835-1903 SCC Reducer
 * Computes the largest strongly connected component (SCC) of the directed
 * world graph (world.json), writes world/world.scc.json (links refiltered
 * to SCC members only). Original world.json is never modified.
 *
 * No network access — operates entirely on the already-fetched world.json.
 *
 * Usage: node tools/worldgen/scc.js
 */

const fs = require("fs");
const path = require("path");

const WORLD_FILE = path.join(__dirname, "../../world/world.json");
const SCC_OUTPUT_FILE = path.join(__dirname, "../../world/world.scc.json");
const SCC_STATS_FILE = path.join(__dirname, "../../world/scc-stats.json");
const MIN_SCC_SIZE = 1000;

/**
 * Tarjan's SCC algorithm, iterative (no recursion — avoids stack overflow
 * on large graphs).
 * @param {string[]} nodes
 * @param {Map<string, string[]>} adj - directed adjacency (title -> outgoing link titles)
 * @returns {string[][]} list of SCCs (each an array of titles), unordered
 */
function tarjanSCC(nodes, adj) {
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  for (const start of nodes) {
    if (indices.has(start)) continue;

    // Iterative Tarjan using an explicit work stack.
    // Each frame: [node, neighborIndex]
    const work = [[start, 0]];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const [v, i] = frame;

      if (i === 0) {
        indices.set(v, index);
        lowlink.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);
      }

      const neighbors = adj.get(v) || [];
      if (i < neighbors.length) {
        frame[1]++;
        const w = neighbors[i];
        if (!indices.has(w)) {
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1][0];
          lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(v)));
        }

        if (lowlink.get(v) === indices.get(v)) {
          const component = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            component.push(w);
          } while (w !== v);
          sccs.push(component);
        }
      }
    }
  }

  return sccs;
}

/**
 * BFS shortest-path distances from a single source, directed.
 * @param {string} source
 * @param {Map<string, string[]>} adj
 * @returns {Map<string, number>}
 */
function bfsDistances(source, adj) {
  const dist = new Map([[source, 0]]);
  const q = [source];
  let qi = 0;
  while (qi < q.length) {
    const u = q[qi++];
    const d = dist.get(u);
    for (const v of adj.get(u) || []) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        q.push(v);
      }
    }
  }
  return dist;
}

function main() {
  const world = JSON.parse(fs.readFileSync(WORLD_FILE, "utf-8"));
  const pages = world.pages;
  const titles = new Set(pages.map((p) => p.title));

  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (const p of pages) {
    adj.set(p.title, p.links.filter((l) => titles.has(l)));
  }

  console.log(`Loaded ${pages.length} pages, computing SCCs...`);
  const sccs = tarjanSCC(Array.from(titles), adj);
  sccs.sort((a, b) => b.length - a.length);
  const largest = sccs[0];

  console.log(`Found ${sccs.length} SCCs. Largest: ${largest.length} pages.`);
  console.log(
    `Top 5 SCC sizes: ${sccs.slice(0, 5).map((s) => s.length).join(", ")}`
  );

  if (largest.length < MIN_SCC_SIZE) {
    console.error(
      `\n✗ DUR: En büyük SCC (${largest.length} sayfa) MIN_SCC_SIZE eşiğinin (${MIN_SCC_SIZE}) altında.`
    );
    console.error(
      `Genişletme (daha fazla sayfa çekmek) gerekebilir — bu karar DeeOne'ındır.`
    );
    process.exit(1);
  }

  const sccTitles = new Set(largest);
  const sccPageMap = new Map(pages.map((p) => [p.title, p]));

  // Rebuild pages restricted to SCC members, links refiltered to SCC only.
  const sccPages = largest.map((title) => {
    const p = sccPageMap.get(title);
    return {
      ...p,
      links: p.links.filter((l) => sccTitles.has(l)),
    };
  });

  const sccAdj = new Map();
  for (const p of sccPages) {
    sccAdj.set(p.title, p.links);
  }

  // All-pairs directed shortest paths within the SCC (guaranteed finite
  // for every ordered pair since it's strongly connected).
  console.log(`Computing all-pairs shortest paths within SCC...`);
  const histogram = {};
  let totalDist = 0;
  let pairCount = 0;
  let diameter = 0;

  for (const source of largest) {
    const dist = bfsDistances(source, sccAdj);
    for (const target of largest) {
      if (source === target) continue;
      const d = dist.get(target);
      if (d === undefined) {
        throw new Error(
          `SCC bütünlüğü ihlali: ${source} -> ${target} erişilemez (SCC olmamalıydı)`
        );
      }
      histogram[d] = (histogram[d] || 0) + 1;
      totalDist += d;
      pairCount++;
      if (d > diameter) diameter = d;
    }
  }

  const avgDist = totalDist / pairCount;
  const emptyTextSCC = sccPages.filter((p) => !p.text).length;
  const emptyTextWorld = pages.filter((p) => !p.text).length;

  const sccStats = {
    sccSize: largest.length,
    sccPercentOfWorld: ((largest.length / pages.length) * 100).toFixed(1),
    totalSCCsFound: sccs.length,
    directedDiameter: diameter,
    averageDirectedDistance: avgDist.toFixed(3),
    pairwiseDistanceHistogram: histogram,
    totalOrderedPairs: pairCount,
    emptyTextPagesInSCC: emptyTextSCC,
    emptyTextPagesInWorld: emptyTextWorld,
  };

  fs.writeFileSync(
    SCC_OUTPUT_FILE,
    JSON.stringify(
      {
        metadata: {
          source: "world.json",
          method: "Tarjan SCC (directed, largest component)",
          generated: new Date().toISOString(),
          pageCount: sccPages.length,
        },
        pages: sccPages,
      },
      null,
      2
    )
  );
  console.log(`✓ ${SCC_OUTPUT_FILE} (${sccPages.length} pages)`);

  fs.writeFileSync(SCC_STATS_FILE, JSON.stringify(sccStats, null, 2));
  console.log(`✓ ${SCC_STATS_FILE}`);
  console.log();
  console.log(`SCC Statistics:`);
  console.log(`  SCC size: ${sccStats.sccSize} (${sccStats.sccPercentOfWorld}% of world)`);
  console.log(`  Directed diameter: ${sccStats.directedDiameter}`);
  console.log(`  Average directed distance: ${sccStats.averageDirectedDistance}`);
  console.log(`  Empty-text pages in SCC: ${sccStats.emptyTextPagesInSCC}`);
  console.log(`  Empty-text pages in world: ${sccStats.emptyTextPagesInWorld}`);
}

if (require.main === module) {
  main();
}
