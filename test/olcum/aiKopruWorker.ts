import { yanitMetniniCikar, type EnvAiRunlayici } from "../../src/worker/workersAiHakemi";

/**
 * G4B-2b — ÖLÇÜM KÖPRÜSÜ WORKER'I (yalnız sınama altyapısı).
 *
 * NEDEN VAR: `env.AI` YALNIZ Workers çalışma zamanının içinde vardır;
 * Node'da (tsx ile koşan ölçüm betiğinde) erişilemez. Öte yandan G4B-2b
 * "her yanıtı süzgeçten ÖNCE ve SONRA tara" diyor — süzgeç ÖNCESİ (HAM)
 * metin ise üretim API'sinin hiçbir yanıtında GÖRÜNMEZ (motor süzülmüş
 * metni döndürür, ham metin Worker'ın içinde kalır).
 *
 * Bu modül o boşluğu KAPATIR: `env.AI`'a giden DAR bir taşıma kanalıdır.
 * Oyun mantığı, süzgeç, köprü ve Kindi BURADA ÇALIŞMAZ — hepsi Node
 * tarafında, ÜRETİM kodundan (`src/worker/hakemKopru.ts`,
 * `src/game/hakemSuzgec.ts`) İÇE AKTARILARAK koşar. Böylece ölçüm hem
 * gerçek modeli hem gerçek süzgeci kullanır, hem de ham/süzülmüş çiftini
 * AYNI üretimden yakalar.
 *
 * KAPSAM: `src/**` DEĞİŞTİRİLMEDİ; bu dosya `test/` altındadır ve
 * dağıtıma girmez (`wrangler.toml`'un `main`'i hâlâ
 * `src/worker/index.ts`). Yalnız `npm run olcum:gercekModel`
 * tarafından `wrangler dev test/olcum/aiKopruWorker.ts` ile çalıştırılır.
 *
 * HATAYI YUTMAZ: üretim adaptörü (`workersAiModeliCagir`) hata/zaman
 * aşımını sabit yanıta çevirir — ölçümde model hatası ile modelin
 * GERÇEKTEN reddi birbirinden ayrılabilmeli, bu yüzden burada hata
 * AÇIKÇA raporlanır ve Node tarafındaki sarmalayıcı onu yeniden fırlatır
 * (böylece üretim adaptörünün yedeği gerçek koşullarda sınanır).
 */

interface HamIstek {
  messages: { role: string; content: string }[];
}

function jsonYanit(govde: unknown, status = 200): Response {
  return new Response(JSON.stringify(govde), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/olcum/saglik" && request.method === "GET") {
      return jsonYanit({ durum: "ok", model: env.AI_MODEL_NAME ?? null });
    }

    if (url.pathname === "/olcum/ham" && request.method === "POST") {
      /**
       * `string | undefined`e genişletilir: `wrangler types` bu
       * değişkeni wrangler.toml'daki DEĞERİN literal tipi olarak üretir,
       * oysa çalışma zamanında EKSİK olabilir — aksi halde aşağıdaki
       * gerçek kontrol "örtüşmeyen karşılaştırma" diye tipe kurban
       * edilirdi (aynı gerekçe: `src/worker/rotalar/maclar.ts`).
       */
      const modelAdi: string | undefined = env.AI_MODEL_NAME;
      if (modelAdi === undefined || modelAdi === "") {
        return jsonYanit({ ok: false, hataMesaji: "AI_MODEL_NAME tanımsız" }, 500);
      }

      let govde: HamIstek;
      try {
        govde = (await request.json()) as HamIstek;
      } catch {
        return jsonYanit({ ok: false, hataMesaji: "gövde ayrıştırılamadı" }, 400);
      }
      if (!Array.isArray(govde.messages) || govde.messages.length === 0) {
        return jsonYanit({ ok: false, hataMesaji: "messages boş" }, 400);
      }

      /**
       * Model adı ÇALIŞMA ZAMANINDA (yapılandırmadan) geldiği için
       * derleme zamanında bilinen bir `AiModelList` anahtarı değildir —
       * `workersAiHakemi.ts` ile AYNI dar arayüz (`EnvAiRunlayici`)
       * kullanılır, yeni bir tip uydurulmaz.
       */
      const ai = env.AI as unknown as EnvAiRunlayici;
      const t0 = Date.now();
      try {
        const sonuc = await ai.run(modelAdi, { messages: govde.messages });
        const metin = yanitMetniniCikar(sonuc);
        return jsonYanit({
          ok: true,
          ham: metin ?? null,
          /** Tanınmayan yanıt şekli — üretim adaptörü bunu da sabit yanıta çevirir. */
          bicimsiz: metin === undefined,
          gecikmeMs: Date.now() - t0,
        });
      } catch (e) {
        return jsonYanit({
          ok: false,
          hataMesaji: e instanceof Error ? e.message : String(e),
          gecikmeMs: Date.now() - t0,
        });
      }
    }

    return jsonYanit({ ok: false, hataMesaji: "bulunamadı" }, 404);
  },
};
