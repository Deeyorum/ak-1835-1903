import type { ModelGirdisi } from "../game/hakemModel";

/**
 * G4B-1 — Workers AI adaptörü.
 *
 * KASITLI OLARAK `HakemModeli` (src/game/hakemModel.ts) TİPİYLE
 * BİREBİR AYNI DEĞİL. `HakemModeli` SENKRONDUR: `(girdi) => string`.
 * Gerçek bir `env.AI.run()` çağrısı ise doğası gereği ASENKRONDUR
 * (`Promise` döner) — JavaScript'te bir Promise'i senkron bir dönüş
 * değerine "düzeltmenin" yolu yoktur. `HakemModeli`'yi (ve onu
 * çağıran `hakemKanali.ts`'teki `mesajGonder()`'ı, dolayısıyla
 * `processTurn()`'ü ve Worker rota işleyicilerini) asenkron hale
 * getirmek CANLI MOTORA dokunmayı gerektirir.
 *
 * Bu, G4B-1'in kapsamı DIŞINDA bırakıldı ("yalnız yerel kod... YALNIZ
 * birim sınamaları") ve G4B-2'ye ÖNERİ olarak not edildi (bkz.
 * DEFTER.md "G4B-1"). Bu modül STANDALONE'dur: `ModelGirdisi`'ni
 * (aynı sözleşme — sistemPrompt, dilim, konuşma) alır, `Promise<string>`
 * döner; canlı motora bağlanmadan ÖNCE yukarıdaki asenkron geçiş
 * yapılmalı.
 *
 * Hata/zaman aşımı/süzgeç reddinde sabit yanıt: çıkış süzgecinin
 * `SABIT_RED_YANITI`siyle AYNI metni kullanır (`hakemSuzgec.ts`'ten
 * İÇE AKTARILIR, kopyalanmaz) — her ikisi de aynı "bilgi sızdırmayan
 * red" anlamına gelir, iki ayrı sabit metin tutmak gelecekte birbirinden
 * kayabilirdi.
 */

import { SABIT_RED_YANITI } from "../game/hakemSuzgec";

export const MODEL_HATASI_SABIT_YANITI = SABIT_RED_YANITI;

/**
 * Gerçek `Ai` sınıfının (worker-configuration.d.ts) "bilinmeyen model /
 * gateway fallback" aşırı yüklemesinin dar bir alt kümesi — model adı
 * çalışma zamanında (yapılandırmadan) geldiği için derleme zamanında
 * bilinen bir `AiModelList` anahtarı DEĞİLDİR. Gerçek `env.AI` nesnesi
 * bunu yapısal olarak (duck typing) karşılar; sahte AI'lar testlerde
 * bu arayüzü doğrudan uygular.
 */
export interface EnvAiRunlayici {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

const VARSAYILAN_ZAMAN_ASIMI_MS = 8000;

export interface WorkersAiAyarlari {
  ai: EnvAiRunlayici;
  /** `env.AI_MODEL_NAME`'den — KODA GÖMÜLÜ değil (bkz. wrangler.toml). */
  modelAdi: string;
  zamanAsimiMs?: number;
}

function zamanAsimiPromise(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("workersAiHakemi: zaman aşımı")), ms);
  });
}

/**
 * `env.AI.run()` yanıtından metni çıkarır. Workers AI'ın metin-üretim
 * modelleri tipik olarak `{ response: string }` döner; bazı modeller
 * `{ result: string }` kullanabilir — ikisi de karşılanır. Tanınmayan
 * biçimde `undefined` (çağıran bunu hata gibi ele alıp sabit yanıta
 * düşer — ham/beklenmeyen yanıt şekli asla olduğu gibi geçirilmez).
 */
export function yanitMetniniCikar(ham: unknown): string | undefined {
  if (typeof ham === "string") return ham;
  if (ham !== null && typeof ham === "object") {
    const n = ham as Record<string, unknown>;
    if (typeof n.response === "string") return n.response;
    if (typeof n.result === "string") return n.result;
  }
  return undefined;
}

/**
 * `ModelGirdisi`'ni Workers AI'ın chat-tarzı `messages` girdisine çevirir.
 * `"hakem"` gönderenler (modelin kendi önceki yanıtları) `assistant`
 * rolüne eşlenir — model kendi geçmiş yanıtlarını "asistan" olarak
 * görmeli, aksi halde bağlamı yanlış yorumlayabilir.
 */
function mesajlariOlustur(girdi: ModelGirdisi): { role: string; content: string }[] {
  return [
    { role: "system", content: girdi.sistemPrompt },
    ...girdi.konusma.map((k) => ({
      role: k.gonderen === "hakem" ? "assistant" : "user",
      content: k.metin,
    })),
  ];
}

/**
 * Workers AI'ı çağırır. Üç durumda (hata, zaman aşımı, boş/şekilsiz
 * yanıt) BİLGİ SIZDIRMAYAN sabit bir yanıt döner — ham hata nesnesi
 * (içeriği bilinmeyen, potansiyel olarak hassas bir hata ayıklama izi
 * taşıyabilir) ASLA çağırana sızdırılmaz.
 *
 * Süzgeç reddi bu fonksiyonun SORUMLULUĞUNDA DEĞİLDİR — bu yalnız
 * modelden metni alır; çıkış süzgeci (`hakemSuzgec.ts`'teki `suz()`)
 * ayrı bir, zaten test edilmiş katmandır ve bu fonksiyonun döndürdüğü
 * HER metne (başarılı veya sabit yanıt) uygulanmaya devam eder.
 */
export async function workersAiModeliCagir(
  ayarlar: WorkersAiAyarlari,
  girdi: ModelGirdisi
): Promise<string> {
  try {
    const cagriSonucu = await Promise.race([
      ayarlar.ai.run(ayarlar.modelAdi, { messages: mesajlariOlustur(girdi) }),
      zamanAsimiPromise(ayarlar.zamanAsimiMs ?? VARSAYILAN_ZAMAN_ASIMI_MS),
    ]);
    const metin = yanitMetniniCikar(cagriSonucu);
    if (metin === undefined || metin.trim().length === 0) {
      return MODEL_HATASI_SABIT_YANITI;
    }
    return metin;
  } catch {
    return MODEL_HATASI_SABIT_YANITI;
  }
}
