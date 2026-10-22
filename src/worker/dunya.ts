import { buildWorldData, type WorldData } from "../game/world";
import type { WorldPage } from "../game/types";
// resolveJsonModule: true (tsconfig.json) — esbuild bunu derleme zamanında
// JS nesnesine gömer (Worker script'inin İÇİNE, D1/KV'den okuma YOK).
// Boyut (G4A sınır ölçümü, bkz. DEFTER.md): 2.583.842 bayt ham,
// 832.694 bayt gzip — 3 MB script bütçesinin altında.
import worldWorkerData from "../../world/world.worker.json";

/**
 * Dünya verisi MODÜL KAPSAMINDA (fetch() işleyicisinin DIŞINDA) bir kez
 * kurulur — Workers'ın standart "global/module init" deseni (WASM/büyük
 * veri yükleme için önerilen yaklaşım), ayrı bir başlatma aşaması olarak
 * çalışır. `buildWorldData()` artık tüm-çiftler mesafe ön-hesabı
 * yapmıyor (bkz. src/game/world.ts G4A notu) — soğuk başlangıç maliyeti
 * ~30-55ms'ye düştü (815ms+'tan, bkz. DEFTER.md "G4A" sınır ölçümü).
 * fetch() İÇİNDE çağrılmaz: bu kadar bir maliyet tek bir istek-işleme
 * bütçesine (10ms) güvenle sığdırılamaz, modül başlatma aşaması bu
 * bütçeden ayrıdır.
 */
const world: WorldData = buildWorldData(worldWorkerData.pages as WorldPage[]);

export function getWorld(): WorldData {
  return world;
}
