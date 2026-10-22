import { spawn, execSync, type ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";

/**
 * G4A — SINAMA: yerel `wrangler dev` + yerel D1 üzerinden uçtan uca.
 *
 * Gerçek bir HTTP sunucusu başlatır (YALNIZ yerel — `--remote` asla
 * verilmez, login/ağ çağrısı YOK), kayıt→sınav→maç→bitiş akışını 20 maç
 * için koşar, HER yanıtı rakip konum sızıntısı için tarar (gerçek gizli
 * konum, yalnız bu test harness'inin kendi D1 sorgusuyla — API'nin
 * KENDİSİ üzerinden DEĞİL — öğrenilir, bu yüzden tarama gerçek bir
 * oracle'a karşı yapılıyor), ve `wrangler dev`'in kendi istek
 * günlüğünden istek başına gecikmeyi toplar.
 *
 * NOT: `wrangler dev` konsol çıktısındaki "(Xms)" DUVAR SAATİ gecikmesidir
 * (D1 yuvarlak gidiş dahil), Workers'ın faturalandırdığı tam CPU süresi
 * DEĞİL — bu arayüzden CPU-süresi başka türlü gözlemlenemiyor. Gerçek
 * CPU maliyeti ayrıca Node üzerinde doğrudan ölçüldü (bkz. DEFTER.md
 * "G4A" sınır ölçümü) — bu test o ölçümü DOĞRULAMAZ, yalnız uçtan uca
 * gecikmenin makul kaldığını teyit eder.
 */

const PROJE_KOKU = path.join(__dirname, "../..");
const PORT = 8799;
const TABAN = `http://localhost:${PORT}`;
const MAC_SAYISI = 20;

/**
 * ORTAM DEFEKTİ (G4A'da bulunan, bildirilir): bu projenin
 * `node_modules/@types/node` paketi (26.6.5) kendi bağımlılığı olan
 * `undici-types`i KURULU DEĞİL bırakıyor (`node_modules/undici-types`
 * yok) — bu, global `fetch()`/`Response` tip bildirimlerini bozuyor
 * (`Response`in `.text()`/`.status` üyeleri tip sisteminde kayboluyor).
 * `npm install` burada GÜVENLİ DEĞİL (bu sanal alanda esbuild'in
 * postinstall betiği EACCES ile başarısız oluyor — tsc/tsx'in npx
 * tuzaklarıyla aynı aile: ortam kasıtlı olarak eksik/kısıtlı). Çözüm,
 * tüm paket ağacını onarmaya çalışmak yerine BU DOSYADA dar bir yerel
 * tip kullanmak — yalnız gerçekten kullanılan iki üyeyi (`status`,
 * `text()`) tanımlar, geri kalan (bozuk) `Response` arayüzüne
 * dokunmaz.
 */
interface FetchYaniti {
  status: number;
  text(): Promise<string>;
}

let failures = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  console.log(`${kosul ? "✓" : "✗"} ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  if (!kosul) failures++;
}

const DOGRU_CEVAPLAR = {
  "kal-hamlesi": "kal",
  "sor-hakeme-hamlesi": "sorHakeme",
  "yakala-hamlesi": "yakala",
  "en-cok-uzmanlik": "2",
  "yanlis-yakalama": "evet",
};

interface YanitKaydi {
  endpoint: string;
  gövde: unknown;
}

/**
 * G4B-1: `bot_gunluk_kota` (günlük maç kotasının D1'e taşınmış hâli,
 * bkz. `migrations/0001_gunluk_mac_kotasi.sql`) de sıfırlanır ve
 * migration YENİDEN uygulanır — aksi halde bu dosya tek başına (hiçbir
 * zaman `npm run test:kota`/`d1:local:migrations:apply` çalıştırılmamış
 * taze bir ortamda) kota tablosu eksik kalır ve `POST /matches` 500 ile
 * başarısız olurdu.
 */
function yerelD1SifirlaVeSemayiUygula(): void {
  execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --command="DROP TABLE IF EXISTS turns; DROP TABLE IF EXISTS matches; DROP TABLE IF EXISTS bots; DROP TABLE IF EXISTS bot_gunluk_kota; DROP TABLE IF EXISTS d1_migrations;"`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  );
  execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --file=db/schema-api.sql`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  );
  execSync(`npx --no-install wrangler d1 migrations apply ak-1835-1903 --local`, {
    cwd: PROJE_KOKU,
    stdio: "pipe",
  });
}

function wranglerDevBaslat(): Promise<{ proc: ChildProcessWithoutNullStreams; log: string[] }> {
  return new Promise((resolve, reject) => {
    /**
     * `detached: true` — `npx wrangler dev` kendi İÇİNDE `sh -c` →
     * `wrangler` CLI → `workerd` ikilisi şeklinde birkaç katman alt
     * süreç başlatıyor (bkz. DEFTER.md "G4A"). Yalnız en üstteki `npx`
     * sürecine `proc.kill()` göndermek bu zinciri SONLANDIRMIYOR —
     * `workerd` yetim kalıyor. `detached: true` bu süreci kendi süreç
     * GRUBUNUN lideri yapar; temizlikte `process.kill(-proc.pid, ...)`
     * (negatif pid) tüm gruba sinyal gönderir.
     */
    const proc = spawn(
      "npx",
      ["--no-install", "wrangler", "dev", "--local", "--port", String(PORT)],
      { cwd: PROJE_KOKU, detached: true }
    );
    const log: string[] = [];
    let hazir = false;
    const zamanAsimi = setTimeout(() => {
      if (!hazir) reject(new Error("wrangler dev 30sn içinde hazır olmadı"));
    }, 30_000);

    function satirIsle(chunk: Buffer) {
      const metin = chunk.toString("utf-8");
      for (const satir of metin.split("\n")) {
        if (satir.trim().length > 0) log.push(satir);
      }
      if (!hazir && metin.includes("Ready on")) {
        hazir = true;
        clearTimeout(zamanAsimi);
        resolve({ proc, log });
      }
    }
    proc.stdout.on("data", satirIsle);
    proc.stderr.on("data", satirIsle);
    proc.on("error", reject);
  });
}

async function istekAt(
  yanitKayitlari: YanitKaydi[],
  endpoint: string,
  init: RequestInit
): Promise<{ status: number; gövde: any }> {
  const yanit = (await fetch(`${TABAN}${endpoint}`, init)) as unknown as FetchYaniti;
  const metin = await yanit.text();
  let gövde: any;
  try {
    gövde = JSON.parse(metin);
  } catch {
    gövde = undefined;
  }
  yanitKayitlari.push({ endpoint, gövde });
  return { status: yanit.status, gövde };
}

/**
 * Sızıntı taraması ALANA ÖZGÜDÜR, yanıtın serileştirilmiş metninin
 * TAMAMINDA körlemesine alt-dizi aramaz.
 *
 * Neden (bu test harness'inde bulunup düzeltildi): `komsular` alanı
 * KASITLI OLARAK herkese açık graf verisidir (dünya yapısı — bkz.
 * src/game/test bot yorumları, "kamuya açık bilgidir"), ve kısa bir
 * sayfa başlığı ("Aristotle") başka, TAMAMEN alakasız ve meşru bir
 * komşu başlığının ("Aristotle's Lagoon") ÖN EKİ olabilir — körlemesine
 * tüm metni taramak bunu YANLIŞ POZİTİF olarak işaretler (ilk yazımda
 * tam olarak bu oldu, 3/20 maçta). Gerçek bir sızıntı yalnız BELİRLİ
 * alanlarda anlamlıdır: `kendiKonum` (her zaman KENDİ konumuna eşit
 * olmalı), hakem yanıtları, araç sonuçları, ve ret nedenleri — bunlar
 * `komsular` gibi graf-yapısı DEĞİL, sunucunun ÜRETTİĞİ anlatı/karar
 * metnidir.
 */
function alanaOzguSizintiKontrolu(gövde: any, rakipKonum: string): string | undefined {
  if (gövde === undefined || gövde === null) return undefined;
  const normRakip = normalizeKisa(rakipKonum);
  if (normRakip.length < 3) return undefined; // bkz. hakemSuzgec.ts KISA_DEGER_ESIGI notu

  const view = gövde.view;
  if (view !== undefined) {
    if (typeof view.kendiKonum === "string" && view.kendiKonum === rakipKonum) {
      return `view.kendiKonum === rakip konumu (${rakipKonum})`;
    }
    for (const y of view.hakemYanitlari ?? []) {
      if (typeof y.yanit === "string" && normalizeKisa(y.yanit).includes(normRakip)) {
        return `view.hakemYanitlari içinde "${rakipKonum}"`;
      }
    }
  }
  if (gövde.toolSonucu !== undefined) {
    const s = normalizeKisa(JSON.stringify(gövde.toolSonucu));
    if (s.includes(normRakip)) return `toolSonucu içinde "${rakipKonum}"`;
  }
  if (typeof gövde.rejected === "string" && normalizeKisa(gövde.rejected).includes(normRakip)) {
    return `rejected içinde "${rakipKonum}"`;
  }
  if (typeof gövde.hata === "string" && normalizeKisa(gövde.hata).includes(normRakip)) {
    return `hata mesajı içinde "${rakipKonum}"`;
  }
  // `komsular` KASITLI OLARAK taranmıyor — bkz. yukarıdaki fonksiyon notu.
  return undefined;
}

function normalizeKisa(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]/g, "");
}

/** Gerçek (gizli) Kaçak/Avcı konumunu test harness'inin KENDİ D1 sorgusuyla okur — oracle, API'den DEĞİL. */
function gercekKonumlariOku(macId: string): { kacakPosition: string; avciPosition: string } {
  const ham = execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --json --command="SELECT state_json FROM matches WHERE id='${macId}'"`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  ).toString("utf-8");
  const sonuc = JSON.parse(ham);
  const stateJson = sonuc[0].results[0].state_json as string;
  const state = JSON.parse(stateJson);
  return { kacakPosition: state.kacakPosition, avciPosition: state.avciPosition };
}

interface MacSonucu {
  tamamlandi: boolean;
  sizintiVarMi: boolean;
  sizintiDetayi?: string;
}

async function birMaciOynat(i: number): Promise<MacSonucu> {
  const yanitlar: YanitKaydi[] = [];
  const rol = i % 2 === 0 ? "avci" : "kacak";
  const uzmanlik = i % 3 === 0 ? [rol === "avci" ? "haritaci" : "profilci"] : [];

  const kayit = await istekAt(yanitlar, "/bots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `sinama-bot-${i}` }),
  });
  if (kayit.status !== 201) {
    return { tamamlandi: false, sizintiVarMi: false, sizintiDetayi: `kayıt başarısız: ${kayit.status}` };
  }
  const apiKey = kayit.gövde.apiKey as string;
  const yetkiBasligi = { Authorization: `Bearer ${apiKey}` };

  const sinavPost = await istekAt(yanitlar, "/exam", {
    method: "POST",
    headers: { ...yetkiBasligi, "Content-Type": "application/json" },
    body: JSON.stringify({ cevaplar: DOGRU_CEVAPLAR }),
  });
  if (sinavPost.gövde.gecti !== true) {
    return { tamamlandi: false, sizintiVarMi: false, sizintiDetayi: "sınav geçilemedi" };
  }

  const macOlustur = await istekAt(yanitlar, "/matches", {
    method: "POST",
    headers: { ...yetkiBasligi, "Content-Type": "application/json" },
    body: JSON.stringify({ rol, uzmanlik, turnLimit: 5 }),
  });
  if (macOlustur.status !== 201) {
    return { tamamlandi: false, sizintiVarMi: false, sizintiDetayi: `maç oluşturma başarısız: ${macOlustur.status}` };
  }
  const macId = macOlustur.gövde.matchId as string;

  // Oracle: gerçek konumları yalnız test harness'i D1'den DOĞRUDAN okuyor.
  const gercek = gercekKonumlariOku(macId);
  const rakipKonum = rol === "avci" ? gercek.kacakPosition : gercek.avciPosition;

  let durum = macOlustur.gövde.status as string;
  let guncelView = macOlustur.gövde.view;
  let guvenlik = 0;
  while (durum === "devam" && guvenlik < 8) {
    const komsular: string[] = guncelView.komsular ?? [];
    const move =
      komsular.length > 0
        ? { type: "git", to: komsular[0] }
        : rol === "kacak"
          ? { type: "kal" }
          : { type: "sorHakeme", mesaj: "What do you know?" };

    const hamle = await istekAt(yanitlar, `/matches/${macId}/move`, {
      method: "POST",
      headers: { ...yetkiBasligi, "Content-Type": "application/json" },
      body: JSON.stringify({ move }),
    });
    durum = hamle.gövde?.status ?? durum;
    guncelView = hamle.gövde?.view ?? guncelView;
    guvenlik++;
  }

  if (durum === "devam") {
    return { tamamlandi: false, sizintiVarMi: false, sizintiDetayi: "güvenlik sınırına takıldı (bitmedi)" };
  }

  // Maç bitti — /record ÇAĞIRMADAN ÖNCEKİ tüm yanıtları sızıntı için tara
  // (alana özgü kontrol — bkz. alanaOzguSizintiKontrolu notu).
  //
  // NOT: `rakipKonum` TEK BİR anlık görüntüdür (maç OLUŞTURULDUĞUNDA
  // okunur). Rakip tur boyunca hareket eder; bu tarama yalnız bu
  // BAŞLANGIÇ konumunun sonraki yanıtlarda (yanlışlıkla) göründüğünü
  // yakalar. Her turun GERÇEK anlık rakip konumunu izlemek (daha sıkı
  // bir kontrol) G4B/G4C'ye bırakıldı; burada katılımcı sayısı (20 maç)
  // ve SPEC'in temel sözleşmesi (kendiKonum/hakem/araç/ret alanları asla
  // rakip bilgisi taşımamalı) için yeterli bir ilk doğrulamadır.
  let sizinti: string | undefined;
  for (const y of yanitlar) {
    const bulunan = alanaOzguSizintiKontrolu(y.gövde, rakipKonum);
    if (bulunan !== undefined) {
      sizinti = `${y.endpoint}: ${bulunan}`;
      break;
    }
  }

  // Record: yalnız bittikten SONRA erişilebilir ve rakip hamlelerini
  // İÇERMESİ beklenir (SPEC §9 — maç sonrası tam kayıt kasıtlıdır, bu
  // sızıntı DEĞİLDİR, aşağıda ayrıca doğrulanır, "sızinti" sayılmaz).
  const kayitSonrasi = await istekAt(yanitlar, `/matches/${macId}/record`, {
    headers: yetkiBasligi,
  });

  return {
    tamamlandi: kayitSonrasi.status === 200,
    sizintiVarMi: sizinti !== undefined,
    sizintiDetayi: sizinti,
  };
}

function wranglerLoguIstekSurelerineAyir(log: string[]): Map<string, number> {
  // Örnek satır: "[wrangler:info] GET /health 200 OK (3ms)"
  const regex = /\[wrangler:info]\s+(GET|POST)\s+(\S+)\s+\d+.*\((\d+)ms\)/;
  const enUzun = new Map<string, number>();
  for (const satir of log) {
    const m = regex.exec(satir);
    if (m === null) continue;
    const [, method, yol, msStr] = m;
    // /matches/{id}/... -> {id} kısmını genelleştir (farklı maç id'leri tek grupta toplansın)
    const genelYol = yol.replace(/\/matches\/[^/]+\//, "/matches/{id}/");
    const anahtar = `${method} ${genelYol}`;
    const ms = Number(msStr);
    enUzun.set(anahtar, Math.max(enUzun.get(anahtar) ?? 0, ms));
  }
  return enUzun;
}

async function main() {
  console.log(`=== G4A SINAMA: yerel wrangler dev + yerel D1, ${MAC_SAYISI} maç ===\n`);

  console.log("Yerel D1 sıfırlanıyor ve şema uygulanıyor...");
  yerelD1SifirlaVeSemayiUygula();

  console.log("wrangler dev başlatılıyor (yalnız yerel, --remote YOK)...");
  const { proc, log } = await wranglerDevBaslat();
  console.log("Hazır.\n");

  try {
    let tamamlananMac = 0;
    let sizintiliMac = 0;

    for (let i = 0; i < MAC_SAYISI; i++) {
      const sonuc = await birMaciOynat(i);
      if (sonuc.tamamlandi) tamamlananMac++;
      if (sonuc.sizintiVarMi) {
        sizintiliMac++;
        console.log(`  ✗ maç ${i}: SIZINTI — ${sonuc.sizintiDetayi}`);
      } else if (!sonuc.tamamlandi) {
        console.log(`  ✗ maç ${i}: tamamlanamadı — ${sonuc.sizintiDetayi}`);
      }
    }

    kontrol(`${MAC_SAYISI} maçın tamamı tamamlandı`, tamamlananMac === MAC_SAYISI, `${tamamlananMac}/${MAC_SAYISI}`);
    kontrol("hiçbir yanıtta rakip konum sızıntısı yok", sizintiliMac === 0, `${sizintiliMac}/${MAC_SAYISI}`);

    console.log(`\n=== İstek başına gecikme (wrangler dev günlüğü, duvar saati) ===`);
    const sureler = wranglerLoguIstekSurelerineAyir(log);
    const asanlar: string[] = [];
    for (const [anahtar, ms] of [...sureler.entries()].sort()) {
      console.log(`  ${anahtar.padEnd(28)} en yavaş: ${ms}ms`);
      if (ms > 10) asanlar.push(`${anahtar} (${ms}ms)`);
    }
    if (asanlar.length > 0) {
      console.log(`\n  (bilgi) 10ms'yi aşan uç noktalar (duvar saati, CPU değil): ${asanlar.join(", ")}`);
    }

    console.log(`\n=== SONUÇ ===`);
    console.log(failures === 0 ? "✓ Tüm API sınama kontrolleri geçti." : `✗ ${failures} kontrol BAŞARISIZ.`);
  } finally {
    // Negatif pid: tüm süreç grubunu (npx → wrangler → workerd) sonlandırır
    // — bkz. wranglerDevBaslat() notu. `proc.pid` tanımsızsa (spawn
    // başarısız olduysa) atlanır.
    if (proc.pid !== undefined) {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // Grup zaten sonlanmışsa ESRCH atar — yoksayılır.
      }
    }
  }

  console.log(failures === 0 ? "\n✓ Çıkılıyor (0)." : `\n✗ Çıkılıyor (1).`);
  // Açık process.exit(): bazı Node sürüm/ortamlarında spawn edilen alt
  // süreçlerin stdio pipe'ları event loop'u canlı tutabiliyor (bkz.
  // DEFTER.md "G4A" — ilk koşuda bu olmadan süreç asla kendiliğinden
  // bitmiyordu). Güvenlik ağı olarak kalıcı.
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
