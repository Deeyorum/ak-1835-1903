// @ts-check
/**
 * AK-1835-1903 — world.scc.json'dan Worker'a gömülecek alt kümeyi üretir.
 *
 * G4A sınır ölçümü (bkz. DEFTER.md "G4A"): motor yalnız title, categories,
 * links, text (Dilbilimci uzmanlığı için) ve pageId (süzgeç sayfa-kimliği
 * koruması için) kullanıyor — url ve revisionId motor/hakem katmanının
 * hiçbir yerinde okunmuyor (grep ile doğrulandı). Bu ikisi düşürülerek
 * Worker script boyutu küçültülür; world.scc.json'un kendisi DEĞİŞTİRİLMEZ
 * (G1/G2 onaylı dünya verisi korunur, yalnız bu türetilmiş alt küme
 * üretilir).
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "../../world/world.scc.json");
const DEST = path.join(__dirname, "../../world/world.worker.json");

function main() {
  const raw = JSON.parse(fs.readFileSync(SRC, "utf-8"));
  const minimal = {
    metadata: raw.metadata,
    pages: raw.pages.map((p) => ({
      pageId: p.pageId,
      title: p.title,
      text: p.text,
      categories: p.categories,
      links: p.links,
    })),
  };
  const json = JSON.stringify(minimal);
  fs.writeFileSync(DEST, json);
  console.log(`${DEST}: ${raw.pages.length} sayfa, ${json.length} bayt (ham)`);
}

main();
