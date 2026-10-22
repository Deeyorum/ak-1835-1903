import { setupMatch, validateSpecializations, DEFAULT_TURN_LIMIT } from "../../game/setup";
import { processTurn, type EkHakemMesaji } from "../../game/engine";
import { kacakView, avciView } from "../../game/views";
import type { AvciMove, KacakMove, Role, Specialization } from "../../game/types";
import { createOlayToplayici } from "../../game/hakemSuzgec";
import { metinSiniriAsiyorMu, turEtiketiUret } from "../../game/hakemKanali";
import { GUVENILMEYEN_METIN_SINIRI } from "../../game/hakemModel";
import { MAX_PANEL } from "../../game/hakemPanel";
import { getWorld } from "../dunya";
import {
  macBul,
  macOlustur,
  macTuruKaydet,
  macTurlariniGetir,
  type MacSatiri,
} from "../veritabani";
import {
  avciHakemKotasi,
  dilimBaglaminiGetir,
  macIcinHakemKanaliOlustur,
  macPaneliniKur,
  type HakemKanaliSecenekleri,
} from "../hakemleri";
import { kindiHamlesi, platformKacakHamlesi } from "../platformBotlari";
import { yetkiCoz } from "../yetki";
import { hizSinirindeMi } from "../hizSiniri";
import { gunlukMacKotasindaMi } from "../kalisiKota";
import { govdeyiAyristir, hataYaniti, jsonYanit } from "../http";
import {
  modelCagriSinirliKanalOlustur,
  VARSAYILAN_MAC_MODEL_CAGRI_SINIRI,
} from "../modelCagriSinirlayici";
import {
  hakemModunuCoz,
  hakemYanitlariniOnHesapla,
  onHesaplanmisModelOlustur,
  turdakiHakemMesajlari,
  type KopruEksikOlayi,
} from "../hakemKopru";

const KACAK_HAMLE_TURLERI = new Set(["git", "kal", "uzmanlikAraci"]);
const AVCI_HAMLE_TURLERI = new Set(["git", "sorHakeme", "uzmanlikAraci", "yakala"]);

function macRolunuBelirle(mac: MacSatiri, botId: string): Role | undefined {
  if (mac.kacakBotId === botId) return "kacak";
  if (mac.avciBotId === botId) return "avci";
  return undefined;
}

interface MacOlusturGovdesi {
  rol?: unknown;
  uzmanlik?: unknown;
  turnLimit?: unknown;
}

/** POST /matches — rol + uzmanlık beyanıyla yeni maç. Diğer rol daima platform botu. */
export async function macOlusturRotasi(
  request: Request,
  db: D1Database,
  env: Env
): Promise<Response> {
  const yetki = await yetkiCoz(db, request, true);
  if (yetki.tur === "anahtarYok") return hataYaniti(401, "Authorization başlığı gerekli.");
  if (yetki.tur === "gecersizAnahtar") return hataYaniti(401, "Geçersiz API anahtarı.");
  if (yetki.tur === "sinavGecilmedi") return hataYaniti(403, "Önce /exam sınavını geçin.");
  const bot = yetki.bot;

  if (!hizSinirindeMi(bot.id)) return hataYaniti(429, "Hız sınırı aşıldı, biraz bekleyin.");
  const kota = Number(env.DAILY_MATCH_QUOTA ?? "100");
  if (!(await gunlukMacKotasindaMi(db, bot.id, kota))) {
    return hataYaniti(429, "Günlük maç kotası doldu.");
  }

  const govdeSonucu = await govdeyiAyristir<MacOlusturGovdesi>(request);
  if (!govdeSonucu.tamam) return govdeSonucu.yanit;
  const govde = govdeSonucu.govde;
  if (govde.rol !== "kacak" && govde.rol !== "avci") {
    return hataYaniti(400, '`rol` "kacak" veya "avci" olmalı.');
  }
  if (!Array.isArray(govde.uzmanlik)) {
    return hataYaniti(400, "`uzmanlik` bir dizi olmalı.");
  }
  const uzmanlik = govde.uzmanlik as Specialization[];
  try {
    validateSpecializations(uzmanlik);
  } catch (e) {
    return hataYaniti(400, e instanceof Error ? e.message : "Geçersiz uzmanlık.");
  }

  let turnLimit = DEFAULT_TURN_LIMIT;
  if (govde.turnLimit !== undefined) {
    if (
      typeof govde.turnLimit !== "number" ||
      !Number.isInteger(govde.turnLimit) ||
      govde.turnLimit < 1
    ) {
      return hataYaniti(400, "`turnLimit` pozitif bir tam sayı olmalı.");
    }
    turnLimit = govde.turnLimit;
  }

  const world = getWorld();
  const seedBytes = new Uint32Array(1);
  crypto.getRandomValues(seedBytes);
  const seed = seedBytes[0];

  const kacakSpecializations: Specialization[] = govde.rol === "kacak" ? uzmanlik : [];
  const avciSpecializations: Specialization[] = govde.rol === "avci" ? uzmanlik : [];

  let state;
  try {
    state = setupMatch(world, { seed, kacakSpecializations, avciSpecializations, turnLimit });
  } catch (e) {
    // Yalnız olağanüstü bir dünya durumunda (bkz. setupMatch) — 500.
    return hataYaniti(500, e instanceof Error ? e.message : "Maç kurulamadı.");
  }

  const matchId = crypto.randomUUID();
  await macOlustur(db, {
    id: matchId,
    seed,
    turnLimit,
    kacakBotId: govde.rol === "kacak" ? bot.id : null,
    avciBotId: govde.rol === "avci" ? bot.id : null,
    kacakSpecializations,
    avciSpecializations,
    state,
  });

  const view = govde.rol === "kacak" ? kacakView(world, state) : avciView(world, state);
  return jsonYanit({ matchId, rol: govde.rol, status: state.status, view }, 201);
}

async function macVeRolDogrula(
  db: D1Database,
  request: Request,
  macId: string
): Promise<
  | { tamam: true; mac: MacSatiri; rol: Role }
  | { tamam: false; yanit: Response }
> {
  const yetki = await yetkiCoz(db, request, true);
  if (yetki.tur === "anahtarYok") {
    return { tamam: false, yanit: hataYaniti(401, "Authorization başlığı gerekli.") };
  }
  if (yetki.tur === "gecersizAnahtar") {
    return { tamam: false, yanit: hataYaniti(401, "Geçersiz API anahtarı.") };
  }
  if (yetki.tur === "sinavGecilmedi") {
    return { tamam: false, yanit: hataYaniti(403, "Önce /exam sınavını geçin.") };
  }

  const mac = await macBul(db, macId);
  if (mac === undefined) return { tamam: false, yanit: hataYaniti(404, "Maç bulunamadı.") };

  const rol = macRolunuBelirle(mac, yetki.bot.id);
  if (rol === undefined) {
    return { tamam: false, yanit: hataYaniti(403, "Bu maça erişiminiz yok.") };
  }

  return { tamam: true, mac, rol };
}

/** GET /matches/{id}/view — rolün KENDİ görünümü (karşı konum YOK). */
export async function macGorunumuRotasi(
  request: Request,
  db: D1Database,
  macId: string
): Promise<Response> {
  const dogrulama = await macVeRolDogrula(db, request, macId);
  if (!dogrulama.tamam) return dogrulama.yanit;
  const { mac, rol } = dogrulama;

  const world = getWorld();
  const view = rol === "kacak" ? kacakView(world, mac.state) : avciView(world, mac.state);
  return jsonYanit({ matchId: macId, rol, status: mac.status, view });
}

interface HamleGovdesi {
  move?: unknown;
  /** Madde 1 (G4B-1b): sorHakeme DIŞINDA, ek hakem mesajı kanalı — yalnız Avcı rolü. */
  hakemMesajlari?: unknown;
}

interface EkMesajAyristirmaSonucu {
  tamam: true;
  mesajlar: EkHakemMesaji[] | undefined;
}
interface EkMesajAyristirmaHatasi {
  tamam: false;
  yanit: Response;
}

/**
 * `hakemMesajlari` gövde alanını ayrıştırır + motorun kotasına karşı
 * ÖN DOĞRULAR. Aşım burada 400 ile REDDEDİLİR — `processTurn`'e hiç
 * ulaşmadan, SESSİZCE KIRPILMADAN (Madde 1'in açık talimatı; motorun
 * kendi iç kırpması — `rejected` listesine ekleyip sessizce devam etme
 * — bu uç nokta için YETERSİZ sayıldı, çünkü o durumda tur yine de
 * TÜKETİLMİŞ olurdu).
 */
function hakemMesajlariniAyristirVeDogrula(
  ham: unknown,
  move: { type?: unknown },
  avciSpecializations: Specialization[]
): EkMesajAyristirmaSonucu | EkMesajAyristirmaHatasi {
  if (ham === undefined) return { tamam: true, mesajlar: undefined };
  if (!Array.isArray(ham)) {
    return { tamam: false, yanit: hataYaniti(400, "`hakemMesajlari` bir dizi olmalı.") };
  }
  // B (goal: dizi üst sınırı): hiçbir maçta panelden `MAX_PANEL` (10)
  // taneden fazla hakem OLAMAZ (bkz. hakemPanel.ts), dolayısıyla meşru
  // bir istek bundan fazla öğe İÇEREMEZ — kota kontrolünden VE döngüden
  // ÖNCE (fiili kota her zaman ≤2 olsa da, bu sınır tasarımın üst
  // sınırından türetilir, o anki kota formülünden DEĞİL).
  if (ham.length > MAX_PANEL) {
    return {
      tamam: false,
      yanit: hataYaniti(400, `\`hakemMesajlari\` en fazla ${MAX_PANEL} öğe içerebilir.`),
    };
  }

  const mesajlar: EkHakemMesaji[] = [];
  for (const oge of ham) {
    if (typeof oge !== "object" || oge === null || typeof (oge as { mesaj?: unknown }).mesaj !== "string") {
      return {
        tamam: false,
        yanit: hataYaniti(
          400,
          "Her `hakemMesajlari` öğesi `{ mesaj: string, hakemId?: string }` biçiminde olmalı."
        ),
      };
    }
    const hakemId = (oge as { hakemId?: unknown }).hakemId;
    if (hakemId !== undefined && typeof hakemId !== "string") {
      return { tamam: false, yanit: hataYaniti(400, "`hakemId` bir dizge olmalı.") };
    }
    const mesajDegeri = (oge as { mesaj: string }).mesaj;
    // C ("Untrusted text contract"): `mesaj` 500 Unicode karakteri
    // AŞARSA 400 — kota aşımıyla AYNI davranış (processTurn'e hiç
    // ulaşmadan, sessizce kırpılmadan; bkz. bu fonksiyonun üstündeki not).
    if (metinSiniriAsiyorMu(mesajDegeri)) {
      return {
        tamam: false,
        yanit: hataYaniti(
          400,
          `\`mesaj\` ${GUVENILMEYEN_METIN_SINIRI} Unicode karakterini aşamaz.`
        ),
      };
    }
    mesajlar.push({ mesaj: mesajDegeri, hakemId: hakemId as string | undefined });
  }

  const kota = avciHakemKotasi(avciSpecializations);
  const sorHakemeKullanimi = move.type === "sorHakeme" ? 1 : 0;
  if (sorHakemeKullanimi + mesajlar.length > kota) {
    return {
      tamam: false,
      yanit: hataYaniti(400, `Hakem mesaj kotası aşıldı (kota=${kota}).`),
    };
  }

  return { tamam: true, mesajlar };
}

/**
 * POST /matches/{id}/move — rol sahibinin tek hamlesi. DİĞER rolün
 * hamlesi platform botu tarafından SUNUCU İÇİNDE hesaplanır (DeeOne
 * kararı: "rakip daima platform botu") — bu yüzden API'de rakibin
 * hamlesini bekleyen ayrı bir uç nokta yok, bir çağrı bir turu bitirir.
 */
export async function macHamleRotasi(
  request: Request,
  db: D1Database,
  macId: string,
  env: Env
): Promise<Response> {
  const dogrulama = await macVeRolDogrula(db, request, macId);
  if (!dogrulama.tamam) return dogrulama.yanit;
  const { mac, rol } = dogrulama;

  if (mac.status !== "devam") {
    return hataYaniti(409, `Maç zaten bitti (durum=${mac.status}).`);
  }

  const govdeSonucu = await govdeyiAyristir<HamleGovdesi>(request);
  if (!govdeSonucu.tamam) return govdeSonucu.yanit;
  const govde = govdeSonucu.govde;
  if (typeof govde.move !== "object" || govde.move === null) {
    return hataYaniti(400, "`move` bir hamle nesnesi olmalı.");
  }
  const move = govde.move as { type?: unknown };
  if (typeof move.type !== "string") {
    return hataYaniti(400, "`move.type` bir dizge olmalı.");
  }

  const izinliTurler = rol === "kacak" ? KACAK_HAMLE_TURLERI : AVCI_HAMLE_TURLERI;
  if (!izinliTurler.has(move.type)) {
    return hataYaniti(
      400,
      `${rol === "kacak" ? "Kaçak" : "Avcı"} için geçersiz hamle tipi: ${move.type}`
    );
  }

  // C ("Untrusted text contract"): `sorHakeme`'in KENDİ `mesaj` alanı da
  // 500 Unicode karakterle sınırlı — `hakemMesajlari` dizisiyle AYNI
  // kural, kota aşımıyla aynı davranış (400, turn tüketilmeden).
  if (move.type === "sorHakeme") {
    const sorHakemeMesaji = (move as { mesaj?: unknown }).mesaj;
    if (typeof sorHakemeMesaji === "string" && metinSiniriAsiyorMu(sorHakemeMesaji)) {
      return hataYaniti(
        400,
        `\`move.mesaj\` ${GUVENILMEYEN_METIN_SINIRI} Unicode karakterini aşamaz.`
      );
    }
  }

  // Madde 1: ek mesaj kanalı YALNIZ Avcı rolü için API'ye bağlanır (goal'ün
  // açık talimatı). Kaçak rolünde gövdede bu alan verilirse REDDEDİLİR
  // (sessizce yoksayılmaz) — motorda eşdeğer bir `kacakHakemMesajlari`
  // yolu VAR (bkz. engine.ts ProcessTurnOptions) ama bu görevde BAĞLANMADI.
  if (govde.hakemMesajlari !== undefined && rol !== "avci") {
    return hataYaniti(400, "`hakemMesajlari` yalnız Avcı rolü için geçerli.");
  }
  let avciHakemMesajlariGovdeden: EkHakemMesaji[] | undefined;
  if (rol === "avci") {
    const ayristirma = hakemMesajlariniAyristirVeDogrula(
      govde.hakemMesajlari,
      move,
      mac.avciSpecializations
    );
    if (!ayristirma.tamam) return ayristirma.yanit;
    avciHakemMesajlariGovdeden = ayristirma.mesajlar;
  }

  const world = getWorld();
  let currentState = mac.state;
  const panel = macPaneliniKur(mac.seed);
  const toplayici = createOlayToplayici();

  // Madde 4 (G4B-1b): maç başına model çağrısı sınırı. `currentState.log`
  // bu maçın ÖNCEKİ turlarının TAMAMINI taşır (motorun kendi birikimi,
  // bkz. engine.ts `log: [...state.log, logEntry]`) — ekstra bir D1
  // okuması GEREKMEZ. G4B-2a: köprünün ön geçişi de AYNI bütçeyi
  // kullandığı için bu hesap kanal kurulumundan ÖNCEYE alındı.
  const gecmisCagriSayisi = currentState.log.reduce(
    (toplam, girdi) => toplam + girdi.hakemMesajlari.length,
    0
  );
  const cagriSinirRaw = env.MAC_MODEL_CAGRI_SINIRI;
  const cagriSiniri =
    cagriSinirRaw === undefined ? VARSAYILAN_MAC_MODEL_CAGRI_SINIRI : Number(cagriSinirRaw);

  /**
   * G4B-2a Madde 1: hamleler hakem kanalından ÖNCE belirlenir.
   * Köprünün ön geçişi, o turda motorun hakem kanalına HANGİ mesajları
   * vereceğini bilmek zorundadır (`sorHakeme` hamlenin İÇİNDE, ek
   * mesajlar Kindi'den ya da gövdeden gelir) — bu yüzden G4B-1b'deki
   * "kanalı kur, sonra hamleyi belirle" sırası TERSİNE çevrildi.
   * Davranış etkisi YOK: ne `macIcinHakemKanaliOlustur` hamleye, ne de
   * bot fonksiyonları kanala bağımlıdır.
   */
  let kacakMove: KacakMove;
  let avciMove: AvciMove;
  let avciHakemMesajlari: EkHakemMesaji[] | undefined;
  if (rol === "kacak") {
    kacakMove = move as KacakMove;
    const kindiKarar = kindiHamlesi(mac.seed, currentState.turn, avciView(world, currentState));
    avciMove = kindiKarar.move;
    avciHakemMesajlari = kindiKarar.hakemMesajlari;
  } else {
    avciMove = move as AvciMove;
    kacakMove = platformKacakHamlesi(mac.seed, currentState.turn, kacakView(world, currentState));
    avciHakemMesajlari = avciHakemMesajlariGovdeden;
  }

  /**
   * G4B-2a Madde 1 — MODEL KÖPRÜSÜ (b yolu, bkz. src/worker/hakemKopru.ts).
   * "sahte" (varsayılan) modda HİÇBİR ŞEY değişmez: `secenekler` boş
   * kalır, `macIcinHakemKanaliOlustur` G4A'nın ağsız sahte modelini
   * kullanır. "workersAi" modunda gerçek model `processTurn`'den ÖNCE
   * `await` ile çağrılır ve hazır yanıtlar senkron bir modelle motora
   * verilir — süzgeç motor tarafında YERİNDE kalır.
   */
  /**
   * SEED-C: etiket artık seed+tur ile birlikte bir sunucu sırrından
   * HMAC-SHA-256 (Web Crypto, asenkron) ile türüyor. Web Crypto hiçbir
   * zaman senkron değildir, motor (`processTurn`) ise KASITLI OLARAK
   * senkron kalır (bkz. `hakemKopru.ts`'teki "motor SENKRON ve SAF
   * kalır" kararı) — bu yüzden hesaplama BURADA, `processTurn`'den
   * ÖNCE, BİR KEZ `await` edilir ve düz bir dizge olarak geçirilir;
   * aynen gerçek model çağrısı için zaten var olan "ön geçiş" deseni
   * gibi (aşağıdaki `workersAi` dalı). `env.ETIKET_SIRRI` tanımsız/boş
   * ise `turEtiketiUret` fail-closed olarak HATA verir — burada
   * YUTULMAZ, istek başarısız olur.
   */
  const turEtiketi = await turEtiketiUret(mac.seed, currentState.turn, env.ETIKET_SIRRI);

  const hakemModu = hakemModunuCoz(env.HAKEM_MODU);
  let kanalSecenekleri: HakemKanaliSecenekleri = { turEtiketi };
  let kopruEksikleri: readonly KopruEksikOlayi[] = [];
  if (hakemModu === "workersAi") {
    /**
     * `wrangler types` bu değişkeni wrangler.toml'daki DEĞERİN literal
     * tipi olarak üretir; `string | undefined`e genişletilir çünkü
     * (a) çalışma zamanında değişken EKSİK olabilir (dağıtım/secret
     * yapılandırması farklı olabilir), (b) aksi hâlde aşağıdaki
     * kontroller "örtüşmeyen karşılaştırma" diye tip hatası verir ve
     * gerçek bir çalışma-zamanı kontrolü tipe kurban edilmiş olurdu.
     *
     * No-implicit-undefined + sessiz bozulma önlemi: yer tutucu bir
     * model adıyla gerçek moda girmek, her çağrının sabit yanıta
     * düşmesi ve bunun bir ÖLÇÜM gibi görünmesi anlamına gelirdi.
     */
    const modelAdi: string | undefined = env.AI_MODEL_NAME;
    if (modelAdi === undefined || modelAdi === "" || modelAdi.startsWith("PLACEHOLDER")) {
      throw new Error(
        `HAKEM_MODU="workersAi" ama AI_MODEL_NAME geçerli değil ("${String(modelAdi)}").`
      );
    }
    const mesajlar = turdakiHakemMesajlari({
      avciMove,
      avciHakemMesajlari,
      avciSpecializations: mac.avciSpecializations,
    });
    const onGecis = await hakemYanitlariniOnHesapla(
      {
        world,
        state: currentState,
        panel,
        dilimBaglami: dilimBaglaminiGetir(),
        ai: env.AI,
        modelAdi,
        gecmisCagriSayisi,
        cagriSiniri,
      },
      mesajlar
    );
    const onHesaplanmis = onHesaplanmisModelOlustur(onGecis.yanitlar, panel.sistemHakemi.id);
    kanalSecenekleri = {
      turEtiketi,
      sistemModeli: onHesaplanmis.sistemModeli,
      kullaniciOtoYanit: onHesaplanmis.kullaniciOtoYanit,
    };
    kopruEksikleri = onHesaplanmis.eksikler;
  }

  const temelHakemKanali = macIcinHakemKanaliOlustur(
    panel,
    () => currentState,
    toplayici,
    kanalSecenekleri
  );
  const { kanal: hakemKanali, asimlar: modelCagriAsimlari } = modelCagriSinirliKanalOlustur(
    temelHakemKanali,
    gecmisCagriSayisi,
    cagriSiniri
  );

  const result = processTurn(world, currentState, kacakMove, avciMove, hakemKanali, {
    avciHakemMesajlari,
    olayToplayici: toplayici,
  });
  currentState = result.state;

  // Madde 4: sınır aşım olayları `rejected`e EKLENİR (TurnLogEntry'nin
  // zaten var olan serbest-metin nedenli alanı — src/game/types.ts'e
  // dokunmadan). "Maç düşmez": durum/tur zaten processTurn'de normal
  // işlendi, burada yalnız KAYIT ekleniyor.
  if (modelCagriAsimlari.length > 0) {
    result.logEntry.rejected = [...(result.logEntry.rejected ?? []), ...modelCagriAsimlari];
  }

  /**
   * G4B-2a Madde 1: köprüde hazır yanıt BULUNAMADIYSA olay kaydedilir
   * (maç DÜŞMEZ — motor sabit yanıtla normal işledi). `role: "avci"`:
   * Worker'da hakem kanalına YALNIZ Avcı mesajı gider (`sorHakeme`
   * Avcı hamlesidir, `kacakHakemMesajlari` API'ye bağlı değil ve
   * `turdakiHakemMesajlari` bağlanırsa HATA verir).
   */
  if (kopruEksikleri.length > 0) {
    result.logEntry.rejected = [
      ...(result.logEntry.rejected ?? []),
      ...kopruEksikleri.map((e) => ({
        role: "avci" as const,
        reason: `Model köprüsü hazır yanıt bulamadı (hakem=${e.hakemId}, sıra=${e.sira}).`,
      })),
    ];
  }

  await macTuruKaydet(db, macId, currentState, result.logEntry);

  // "403 (beyan dışı araç)" — yalnız UNDECLARED uzmanlık reddi 403'tür;
  // diğer geçersiz hamleler (örn. kopuk bağlantı) 400'dür (bkz. yukarı).
  const kendiRed = (result.logEntry.rejected ?? []).find((r) => r.role === rol);
  if (kendiRed !== undefined && move.type === "uzmanlikAraci") {
    const beyanDisi = kendiRed.reason.startsWith("Beyan edilmemiş uzmanlık");
    return hataYaniti(beyanDisi ? 403 : 400, kendiRed.reason);
  }

  const view = rol === "kacak" ? kacakView(world, currentState) : avciView(world, currentState);
  const kendiToolSonucu = (result.logEntry.toolSonuclari ?? []).find((t) => t.role === rol);
  const kendiRedGenel = kendiRed?.reason;

  return jsonYanit({
    matchId: macId,
    rol,
    status: currentState.status,
    view,
    toolSonucu: kendiToolSonucu?.sonuc,
    rejected: kendiRedGenel,
  });
}

/** GET /matches/{id}/record — yalnız maç bitince, yalnız katılımcılara (SPEC §9). */
export async function macKaydiRotasi(
  request: Request,
  db: D1Database,
  macId: string
): Promise<Response> {
  const dogrulama = await macVeRolDogrula(db, request, macId);
  if (!dogrulama.tamam) return dogrulama.yanit;
  const { mac } = dogrulama;

  if (mac.status === "devam") {
    return hataYaniti(409, "Maç henüz bitmedi.");
  }

  const turlar = await macTurlariniGetir(db, macId);
  return jsonYanit({
    matchId: macId,
    status: mac.status,
    seed: mac.seed,
    turnLimit: mac.turnLimit,
    kacakSpecializations: mac.kacakSpecializations,
    avciSpecializations: mac.avciSpecializations,
    turns: turlar,
  });
}
