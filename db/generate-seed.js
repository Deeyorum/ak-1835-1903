// @ts-check
/**
 * Generate db/seed.sql from world/world.json
 * Usage: node db/generate-seed.js
 */

const fs = require("fs");
const path = require("path");

const WORLD_FILE = path.join(__dirname, "../world/world.json");
const OUTPUT_FILE = path.join(__dirname, "./seed.sql");

function escapeSql(str) {
  if (str === null || str === undefined) return "NULL";
  return "'" + str.replace(/'/g, "''") + "'";
}

function main() {
  if (!fs.existsSync(WORLD_FILE)) {
    console.error(`world.json not found: ${WORLD_FILE}`);
    process.exit(1);
  }

  const world = JSON.parse(fs.readFileSync(WORLD_FILE, "utf-8"));
  const pages = world.pages || [];

  const lines = [
    "-- AK-1835-1903 Seed Script",
    `-- Generated ${new Date().toISOString()}`,
    `-- Pages: ${pages.length}`,
    "",
    "BEGIN TRANSACTION;",
    "",
  ];

  // Insert pages
  pages.forEach((page) => {
    const sql =
      `INSERT INTO pages (page_id, title, url, revision_id, intro_text) VALUES (` +
      `${page.pageId}, ` +
      `${escapeSql(page.title)}, ` +
      `${escapeSql(page.url)}, ` +
      `${page.revisionId || "NULL"}, ` +
      `${escapeSql(page.text ? page.text.substring(0, 5000) : "")}` +
      `);`;
    lines.push(sql);
  });

  lines.push("");

  // Insert links
  pages.forEach((page) => {
    page.links.forEach((link) => {
      const sql =
        `INSERT INTO links (source_page_id, target_title) VALUES (` +
        `${page.pageId}, ${escapeSql(link)});`;
      lines.push(sql);
    });
  });

  lines.push("");

  // Insert categories
  pages.forEach((page) => {
    page.categories.forEach((cat) => {
      const sql =
        `INSERT INTO categories (page_id, category_title) VALUES (` +
        `${page.pageId}, ${escapeSql(cat)});`;
      lines.push(sql);
    });
  });

  lines.push("");
  lines.push("COMMIT;");

  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"));
  console.log(`✓ Generated ${OUTPUT_FILE}`);
  console.log(
    `  Pages: ${pages.length}, Links: ${pages.reduce((sum, p) => sum + p.links.length, 0)}, Categories: ${pages.reduce((sum, p) => sum + p.categories.length, 0)}`
  );
}

if (require.main === module) {
  main();
}
