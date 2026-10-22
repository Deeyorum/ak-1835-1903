import { sinaviDegerlendir, sinavSorulariniGetir } from "../girisSinavi";
import { botSinaviGecir } from "../veritabani";
import { yetkiCoz } from "../yetki";
import { govdeyiAyristir, hataYaniti, jsonYanit } from "../http";

/** GET /exam — sınav sorularını (cevapsız) döner. */
export async function sinaviGetir(request: Request, db: D1Database): Promise<Response> {
  const yetki = await yetkiCoz(db, request, false);
  if (yetki.tur === "anahtarYok") return hataYaniti(401, "Authorization başlığı gerekli.");
  if (yetki.tur === "gecersizAnahtar") return hataYaniti(401, "Geçersiz API anahtarı.");

  return jsonYanit({ sorular: sinavSorulariniGetir() });
}

interface SinavGovdesi {
  cevaplar?: unknown;
}

/** POST /exam — cevapları değerlendirir; tümü doğruysa anahtarı etkinleştirir. */
export async function sinaviDegerlendirVeKaydet(
  request: Request,
  db: D1Database
): Promise<Response> {
  const yetki = await yetkiCoz(db, request, false);
  if (yetki.tur === "anahtarYok") return hataYaniti(401, "Authorization başlığı gerekli.");
  if (yetki.tur === "gecersizAnahtar") return hataYaniti(401, "Geçersiz API anahtarı.");

  const govdeSonucu = await govdeyiAyristir<SinavGovdesi>(request);
  if (!govdeSonucu.tamam) return govdeSonucu.yanit;
  const govde = govdeSonucu.govde;
  if (
    typeof govde.cevaplar !== "object" ||
    govde.cevaplar === null ||
    Array.isArray(govde.cevaplar)
  ) {
    return hataYaniti(400, "`cevaplar` bir { soruId: cevap } nesnesi olmalı.");
  }

  const sonuc = sinaviDegerlendir(govde.cevaplar as Record<string, string>);
  if (!sonuc.gecti) {
    return jsonYanit({ gecti: false, yanlisSoruIdleri: sonuc.yanlisSoruIdleri }, 200);
  }

  const bot = yetki.tur === "basarili" || yetki.tur === "sinavGecilmedi" ? yetki.bot : undefined;
  if (bot === undefined) return hataYaniti(401, "Geçersiz API anahtarı.");

  await botSinaviGecir(db, bot.id);
  return jsonYanit({ gecti: true });
}
