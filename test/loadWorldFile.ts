import * as fs from "fs";
import { buildWorldData, type WorldData } from "../src/game/world";
import type { WorldPage } from "../src/game/types";

/**
 * Yerel test aracı: world.scc.json dosyasını diskten okur, saf
 * buildWorldData()'ya besler. fs kullanımı yalnız burada — src/game
 * Cloudflare'den bağımsız kalır.
 */
export function loadWorldFromFile(filePath: string): WorldData {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return buildWorldData(raw.pages as WorldPage[]);
}
