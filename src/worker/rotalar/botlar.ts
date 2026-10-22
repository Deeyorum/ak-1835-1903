import { botOlustur } from "../veritabani";
import { anahtarKarmasi, uretApiAnahtari } from "../kimlikDogrulama";
import { govdeyiAyristir, hataYaniti, jsonYanit } from "../http";
import {
  GUNLUK_BOT_KAYIT_TAVANI,
  gunlukBotKayitSayisi,
  saniyeGunSonunaKadarUtc,
} from "../botKayitTavani";

interface BotKayitGovdesi {
  name?: unknown;
  owner?: unknown;
}

/**
 * POST /bots — kayıt. API anahtarı yalnız BU yanıtta, bir kez döner.
 *
 * G4C-4a-FIX (madde 2): günlük (UTC) kayıt tavanı `/matches`
 * oluşturmadaki kota kontrolüyle AYNI SIRADA — gövde ayrıştırmadan
 * ÖNCE — kontrol edilir; tavan doluyken hiçbir yazma OLMAZ.
 */
export async function botKaydet(request: Request, db: D1Database): Promise<Response> {
  const gunlukSayac = await gunlukBotKayitSayisi(db);
  if (gunlukSayac >= GUNLUK_BOT_KAYIT_TAVANI) {
    return hataYaniti(429, "Günlük bot kayıt tavanı doldu.", {
      "Retry-After": String(saniyeGunSonunaKadarUtc()),
    });
  }

  const sonuc = await govdeyiAyristir<BotKayitGovdesi>(request);
  if (!sonuc.tamam) return sonuc.yanit;
  const govde = sonuc.govde;
  if (typeof govde.name !== "string" || govde.name.trim().length === 0) {
    return hataYaniti(400, "`name` zorunlu ve boş olmayan bir dizge olmalı.");
  }
  if (govde.owner !== undefined && typeof govde.owner !== "string") {
    return hataYaniti(400, "`owner` verilirse dizge olmalı.");
  }

  const id = crypto.randomUUID();
  const apiAnahtari = uretApiAnahtari();
  const karma = await anahtarKarmasi(apiAnahtari);

  await botOlustur(db, id, govde.name.trim(), govde.owner ?? null, karma);

  return jsonYanit(
    {
      botId: id,
      apiKey: apiAnahtari,
      not: "Bu anahtar yalnız şimdi gösterilir, tekrar alınamaz. /exam ile etkinleştirin.",
    },
    201
  );
}
