import { anahtarKarmasi, yetkiBasligindanAnahtarCikar } from "./kimlikDogrulama";
import { botKarmayaGoreBul, type BotKaydi } from "./veritabani";

export type YetkiSonucu =
  | { tur: "basarili"; bot: BotKaydi }
  | { tur: "anahtarYok" }
  | { tur: "gecersizAnahtar" }
  | { tur: "sinavGecilmedi"; bot: BotKaydi };

/**
 * `Authorization: Bearer <anahtar>` başlığını çözer ve bota eşler.
 * `sinavGerekli=true` ise (varsayılan — /matches uç noktaları için)
 * sınavı geçmemiş bir bot `sinavGecilmedi` olarak reddedilir; /exam uç
 * noktaları kendi anahtarıyla (sınav öncesi de) kimlik doğrulayabilmeli,
 * bu yüzden orada `sinavGerekli=false` geçilir.
 */
export async function yetkiCoz(
  db: D1Database,
  request: Request,
  sinavGerekli: boolean
): Promise<YetkiSonucu> {
  const anahtar = yetkiBasligindanAnahtarCikar(request.headers.get("Authorization"));
  if (anahtar === undefined) return { tur: "anahtarYok" };

  const karma = await anahtarKarmasi(anahtar);
  const bot = await botKarmayaGoreBul(db, karma);
  if (bot === undefined) return { tur: "gecersizAnahtar" };

  if (sinavGerekli && !bot.examPassed) return { tur: "sinavGecilmedi", bot };
  return { tur: "basarili", bot };
}
