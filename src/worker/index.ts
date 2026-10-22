/**
 * AK-1835-1903 Worker — G4A API iskeleti.
 *
 * Yalnız HTTP yönlendirme burada yapılır; oyun mantığı src/game/*'tan
 * (saf motor) GELİR, buraya TAŞINMAZ. Bu dosya ve src/worker/* Worker'a
 * ÖZGÜDÜR (D1Database, crypto.subtle, global Env — Workers runtime
 * türleri); src/game hâlâ tamamen ortam-bağımsızdır.
 */

import { botKaydet } from "./rotalar/botlar";
import { sinaviDegerlendirVeKaydet, sinaviGetir } from "./rotalar/sinav";
import {
  macGorunumuRotasi,
  macHamleRotasi,
  macKaydiRotasi,
  macOlusturRotasi,
} from "./rotalar/maclar";
import { meydanOkumaRotasi } from "./rotalar/meydanOkuma";
import { hakkindaRotasi, sorAsistanaBetigi } from "./rotalar/hakkinda";
import { sssRotasi } from "./rotalar/sss";
import { hataYaniti, jsonYanit } from "./http";

const MAC_YOLU = /^\/matches\/([^/]+)\/(view|move|record)$/;

export default {
  /**
   * G4C-4a-FIX (madde 1) — global hata yakalayıcı. Rota içinde
   * yakalanmayan bir istisna (örn. `turEtiketiUret`'in fail-closed
   * `throw`'u, bir D1 hatası) artık platformun varsayılan istisna
   * yanıtına DEĞİL, bu `catch`'e düşer: istemciye SABİT, iç ayrıntı
   * (mesaj/yığın izi/dosya yolu/sürüm) içermeyen bir 500 JSON döner.
   * `console.error` yalnız hata nesnesini yazar — bu depodaki tüm
   * uncaught throw'lar (bkz. GUVENLIK-DENETIMI-1 Bulgu 1 analizi) sır,
   * token ya da istek gövdesi İÇERMEZ; istek gövdesi burada hiçbir
   * koşulda loglanmaz.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      const { method } = request;

      if (pathname === "/health" && method === "GET") {
        return jsonYanit({ status: "ok", timestamp: new Date().toISOString(), version: "0.1" });
      }

      if (pathname === "/challenge" && method === "GET") {
        return meydanOkumaRotasi();
      }

      if (pathname === "/about" && method === "GET") {
        return hakkindaRotasi();
      }

      if (pathname === "/assets/about.js" && method === "GET") {
        return sorAsistanaBetigi();
      }

      if (pathname === "/faq" && method === "GET") {
        return sssRotasi();
      }

      if (pathname === "/bots" && method === "POST") {
        return await botKaydet(request, env.DB);
      }

      if (pathname === "/exam" && method === "GET") {
        return await sinaviGetir(request, env.DB);
      }
      if (pathname === "/exam" && method === "POST") {
        return await sinaviDegerlendirVeKaydet(request, env.DB);
      }

      if (pathname === "/matches" && method === "POST") {
        return await macOlusturRotasi(request, env.DB, env);
      }

      const macEslesme = MAC_YOLU.exec(pathname);
      if (macEslesme !== undefined && macEslesme !== null) {
        const [, macId, altYol] = macEslesme;
        // NOT (G4C-4a-FIX): bu üç çağrı KASITLI OLARAK `await`li —
        // `return sozFonksiyonu()` (await'siz) reddi try/catch'in
        // DIŞINA kaçırır (fonksiyon zaten geri döndükten SONRA reddolur).
        if (altYol === "view" && method === "GET") return await macGorunumuRotasi(request, env.DB, macId);
        if (altYol === "move" && method === "POST") return await macHamleRotasi(request, env.DB, macId, env);
        if (altYol === "record" && method === "GET") return await macKaydiRotasi(request, env.DB, macId);
        return hataYaniti(405, "Desteklenmeyen metod.");
      }

      return hataYaniti(404, "Bulunamadı.");
    } catch (e) {
      console.error("[fetch] Yakalanmayan hata:", e);
      return hataYaniti(500, "Sunucu hatası.");
    }
  },
};
