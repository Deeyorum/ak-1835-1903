import { spawn, execSync, type ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";

/**
 * G4B-1b — Madde 1: ek mesaj kanalının API'ye bağlanması, yerel
 * `wrangler dev` + yerel D1 üzerinden uçtan uca (bkz. test/api/api.test.ts
 * ve test/worker/kalisiKota.test.ts'deki AYNI harness deseni).
 *
 * Doğrulanan sözleşme (Madde 1, DEFTER.md "G4B-1b"):
 *   - POST /matches/{id}/move gövdesine `hakemMesajlari` eklenir, motorun
 *     `avciHakemMesajlari`'na geçer (yanıt BİRİKİR, bir tur sonra görünür).
 *   - Kota aşımı 400 ile REDDEDİLİR — SESSİZCE KIRPILMAZ: tur
 *     TÜKETİLMEZ (D1'deki gerçek `tur` sayacı DEĞİŞMEZ).
 *   - Kaçak rolünde bu alan verilirse REDDEDİLİR (yalnız Avcı'ya bağlı).
 *   - Arabulucu beyanlıyken kota 2'dir (taban 1 + 1).
 */

const PROJE_KOKU = path.join(__dirname, "../..");
const PORT = 8802;
const TABAN = `http://localhost:${PORT}`;

let failures = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  console.log(`${kosul ? "✓" : "✗"} ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  if (!kosul) failures++;
}

interface FetchYaniti {
  status: number;
  text(): Promise<string>;
}

function yerelD1SifirlaVeSemayiUygula(): void {
  execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --command="DROP TABLE IF EXISTS turns; DROP TABLE IF EXISTS matches; DROP TABLE IF EXISTS bots; DROP TABLE IF EXISTS bot_gunluk_kota; DROP TABLE IF EXISTS d1_migrations;"`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  );
  execSync(`npx --no-install wrangler d1 execute ak-1835-1903 --local --file=db/schema-api.sql`, {
    cwd: PROJE_KOKU,
    stdio: "pipe",
  });
  execSync(`npx --no-install wrangler d1 migrations apply ak-1835-1903 --local`, {
    cwd: PROJE_KOKU,
    stdio: "pipe",
  });
}

function wranglerDevBaslat(): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["--no-install", "wrangler", "dev", "--local", "--port", String(PORT)], {
      cwd: PROJE_KOKU,
      detached: true,
    });
    let hazir = false;
    const zamanAsimi = setTimeout(() => {
      if (!hazir) reject(new Error("wrangler dev 30sn içinde hazır olmadı"));
    }, 30_000);
    function satirIsle(chunk: Buffer) {
      if (!hazir && chunk.toString("utf-8").includes("Ready on")) {
        hazir = true;
        clearTimeout(zamanAsimi);
        resolve(proc);
      }
    }
    proc.stdout.on("data", satirIsle);
    proc.stderr.on("data", satirIsle);
    proc.on("error", reject);
  });
}

async function istekAt(endpoint: string, init: RequestInit): Promise<{ status: number; gövde: any }> {
  const yanit = (await fetch(`${TABAN}${endpoint}`, init)) as unknown as FetchYaniti;
  const metin = await yanit.text();
  let gövde: any;
  try {
    gövde = JSON.parse(metin);
  } catch {
    gövde = undefined;
  }
  return { status: yanit.status, gövde };
}

function macTurunuOku(macId: string): number {
  const ham = execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --json --command="SELECT state_json FROM matches WHERE id='${macId}'"`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  ).toString("utf-8");
  const sonuc = JSON.parse(ham);
  const stateJson = sonuc[0].results[0].state_json as string;
  return JSON.parse(stateJson).turn as number;
}

const DOGRU_CEVAPLAR = {
  "kal-hamlesi": "kal",
  "sor-hakeme-hamlesi": "sorHakeme",
  "yakala-hamlesi": "yakala",
  "en-cok-uzmanlik": "2",
  "yanlis-yakalama": "evet",
};

async function botKurVeYetkiAl(ad: string): Promise<{ apiKey: string }> {
  const kayit = await istekAt("/bots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: ad }),
  });
  const apiKey = kayit.gövde.apiKey as string;
  await istekAt("/exam", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cevaplar: DOGRU_CEVAPLAR }),
  });
  return { apiKey };
}

async function main() {
  console.log(`=== G4B-1b Madde 1: ek mesaj kanalı sınaması ===\n`);

  console.log("Yerel D1 sıfırlanıyor, şema + migration uygulanıyor...");
  yerelD1SifirlaVeSemayiUygula();

  console.log("wrangler dev başlatılıyor (yalnız yerel, --remote YOK)...");
  const proc = await wranglerDevBaslat();
  console.log("Hazır.\n");

  try {
    // --- 1) Avcı: tek bir ek mesaj (sorHakeme KULLANMADAN) kabul
    // edilir, yanıt BİR TUR SONRA view.hakemYanitlari'de görünür. ---
    {
      const { apiKey } = await botKurVeYetkiAl("madde1-avci-1");
      const yetki = { Authorization: `Bearer ${apiKey}` };
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 10 }),
      });
      const macId = mac.gövde.matchId as string;
      const komsu = mac.gövde.view.komsular[0];

      const hamle1 = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({
          move: { type: "git", to: komsu },
          hakemMesajlari: [{ mesaj: "What do you know?", hakemId: "sistem" }],
        }),
      });
      kontrol("ek mesaj kanalıyla hamle kabul edilir (200)", hamle1.status === 200, String(hamle1.status));
      // NOT: `/move` çağrısı tur 1'i işler VE state.turn'ü 2'ye
      // yükseltir (engine.ts her çağrıda `turn: state.turn + 1` yapar,
      // hamle reddedilsin/edilmesin) — bu yüzden "bir tur gecikme"
      // yanıtın görünür olması için başka bir HTTP çağrısı GEREKTİRMEZ:
      // BU yanıtın KENDİSİ zaten state.turn=2'yi yansıtır, soru ise
      // turn=1'de sorulmuştur (1 < 2) → hemen görünür.
      kontrol(
        "aynı yanıtta (state.turn artık 2) ek mesajın yanıtı BİRİKMİŞ görünür",
        (hamle1.gövde?.view?.hakemYanitlari ?? []).length === 1 &&
          hamle1.gövde.view.hakemYanitlari[0].hakemId === "sistem" &&
          typeof hamle1.gövde.view.hakemYanitlari[0].avciKonum === "string",
        JSON.stringify(hamle1.gövde?.view?.hakemYanitlari)
      );

      const hamle2 = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ move: { type: "git", to: hamle1.gövde.view.komsular[0] } }),
      });
      kontrol(
        "başka soru sorulmadıysa yanıt kümesi değişmeden KALICI",
        (hamle2.gövde?.view?.hakemYanitlari ?? []).length === 1,
        JSON.stringify(hamle2.gövde?.view?.hakemYanitlari)
      );
    }

    // --- 2) Kota aşımı: sorHakeme (1) + ek mesaj (1) = 2 > kota(1) →
    // 400, SESSİZCE KIRPILMAZ: D1'deki `turn` DEĞİŞMEMİŞ olmalı. ---
    {
      const { apiKey } = await botKurVeYetkiAl("madde1-avci-2");
      const yetki = { Authorization: `Bearer ${apiKey}` };
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 10 }),
      });
      const macId = mac.gövde.matchId as string;
      const turOnce = macTurunuOku(macId);

      const asanHamle = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({
          move: { type: "sorHakeme", mesaj: "What do you know?" },
          hakemMesajlari: [{ mesaj: "What do you know?", hakemId: "kullanici-1" }],
        }),
      });
      kontrol(
        "kota aşımı (sorHakeme + ek mesaj > kota=1) 400 ile reddedilir",
        asanHamle.status === 400,
        `durum=${asanHamle.status} gövde=${JSON.stringify(asanHamle.gövde)}`
      );

      const turSonra = macTurunuOku(macId);
      kontrol(
        "kota aşan istek tur TÜKETMEMİŞ (sessizce kırpma YOK, tüm istek reddedildi)",
        turSonra === turOnce,
        `önce=${turOnce} sonra=${turSonra}`
      );
    }

    // --- 3) Kaçak rolünde hakemMesajlari verilirse reddedilir. ---
    {
      const { apiKey } = await botKurVeYetkiAl("madde1-kacak-1");
      const yetki = { Authorization: `Bearer ${apiKey}` };
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "kacak", uzmanlik: [], turnLimit: 10 }),
      });
      const macId = mac.gövde.matchId as string;

      const hamle = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({
          move: { type: "kal" },
          hakemMesajlari: [{ mesaj: "hi", hakemId: "sistem" }],
        }),
      });
      kontrol(
        "Kaçak rolünde hakemMesajlari 400 ile reddedilir",
        hamle.status === 400,
        `durum=${hamle.status} gövde=${JSON.stringify(hamle.gövde)}`
      );
    }

    // --- 4) Arabulucu beyanlıyken kota 2'dir: sorHakeme + 1 ek mesaj
    // (toplam 2) KABUL edilir (aşım DEĞİL). ---
    {
      const { apiKey } = await botKurVeYetkiAl("madde1-avci-arabulucu");
      const yetki = { Authorization: `Bearer ${apiKey}` };
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "avci", uzmanlik: ["arabulucu"], turnLimit: 10 }),
      });
      const macId = mac.gövde.matchId as string;

      const hamle = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({
          move: { type: "sorHakeme", mesaj: "What do you know?" },
          hakemMesajlari: [{ mesaj: "What do you know?", hakemId: "kullanici-1" }],
        }),
      });
      kontrol(
        "Arabulucu beyanlıyken kota=2, sorHakeme+1 ek mesaj KABUL edilir",
        hamle.status === 200,
        `durum=${hamle.status} gövde=${JSON.stringify(hamle.gövde)}`
      );
    }

    // --- 5) E: "Untrusted text contract" — `mesaj` 500 Unicode karakter
    // sınırı. Tam 500 kabul edilir; 501 reddedilir (400, kota aşımıyla
    // AYNI davranış — tur TÜKETİLMEZ). Bkz. SPEC §7c. ---
    {
      const { apiKey } = await botKurVeYetkiAl("madde-e-500sinir");
      const yetki = { Authorization: `Bearer ${apiKey}` };
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 10 }),
      });
      const macId = mac.gövde.matchId as string;
      const turOnce = macTurunuOku(macId);
      const komsu1 = mac.gövde.view.komsular[0];

      const tamSinirda = "a".repeat(500);
      const kabulEdilen = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({
          move: { type: "git", to: komsu1 },
          hakemMesajlari: [{ mesaj: tamSinirda, hakemId: "sistem" }],
        }),
      });
      kontrol(
        "tam 500 Unicode karakterlik mesaj KABUL edilir (200)",
        kabulEdilen.status === 200,
        `durum=${kabulEdilen.status} gövde=${JSON.stringify(kabulEdilen.gövde)}`
      );

      const komsu2 = kabulEdilen.gövde?.view?.komsular?.[0];
      const asanMesaj = "a".repeat(501);
      const reddedilen = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({
          move: { type: "git", to: komsu2 },
          hakemMesajlari: [{ mesaj: asanMesaj, hakemId: "sistem" }],
        }),
      });
      kontrol(
        "501 Unicode karakterlik mesaj 400 ile REDDEDİLİR",
        reddedilen.status === 400,
        `durum=${reddedilen.status} gövde=${JSON.stringify(reddedilen.gövde)}`
      );

      const turSonra = macTurunuOku(macId);
      kontrol(
        "500 karakter sınırını aşan istek tur TÜKETMEMİŞ (kota aşımıyla aynı davranış)",
        turSonra === turOnce + 1, // yalnız 1. (kabul edilen) çağrı tur ilerletti
        `önce=${turOnce} sonra=${turSonra}`
      );
    }

    // --- 6) E: Etiketli hakem yanıtı GERÇEK HTTP yanıtında. Ayrı
    // `etiket` alanı var, `yanit` o etiketle sarılı gelir, ve tur
    // değiştikçe etiket DEĞİŞİR (sabit bir sözcük DEĞİL). ---
    {
      const { apiKey } = await botKurVeYetkiAl("madde-e-etiket");
      const yetki = { Authorization: `Bearer ${apiKey}` };
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 10 }),
      });
      const macId = mac.gövde.matchId as string;
      let komsu = mac.gövde.view.komsular[0];

      const hamleT1 = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({
          move: { type: "git", to: komsu },
          hakemMesajlari: [{ mesaj: "What do you know?", hakemId: "sistem" }],
        }),
      });
      const yanitlarT1 = hamleT1.gövde?.view?.hakemYanitlari ?? [];
      const kayitT1 = yanitlarT1[0];
      kontrol(
        "gerçek HTTP yanıtında hakemYanitlari[0].etiket alanı VAR ve boş değil",
        kayitT1 !== undefined && typeof kayitT1.etiket === "string" && kayitT1.etiket.length > 0,
        JSON.stringify(kayitT1)
      );
      kontrol(
        "yanit alanı o etiketle SARILI gelir (<<ETİKET>>...<<ETİKET>>)",
        kayitT1 !== undefined &&
          kayitT1.yanit.startsWith(`<<${kayitT1.etiket}>>`) &&
          kayitT1.yanit.endsWith(`<<${kayitT1.etiket}>>`),
        kayitT1?.yanit
      );

      komsu = hamleT1.gövde.view.komsular[0];
      const hamleT2 = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({
          move: { type: "git", to: komsu },
          hakemMesajlari: [{ mesaj: "What do you know?", hakemId: "sistem" }],
        }),
      });
      const yanitlarT2 = hamleT2.gövde?.view?.hakemYanitlari ?? [];
      kontrol(
        "2. turun yanıtı da BİRİKMİŞ görünür (toplam 2 kayıt)",
        yanitlarT2.length === 2,
        JSON.stringify(yanitlarT2.map((y: any) => y.turn))
      );
      const kayit1 = yanitlarT2.find((y: any) => y.turn === 1);
      const kayit2 = yanitlarT2.find((y: any) => y.turn === 2);
      kontrol(
        "tur değişince etiket DEĞİŞİR (sabit bir sözcük değil)",
        kayit1 !== undefined &&
          kayit2 !== undefined &&
          kayit1.etiket !== kayit2.etiket &&
          kayit1.etiket.length > 0 &&
          kayit2.etiket.length > 0,
        `t1=${kayit1?.etiket} t2=${kayit2?.etiket}`
      );
    }

    console.log(`\n=== SONUÇ ===`);
    console.log(failures === 0 ? "✓ Ek mesaj kanalı sınaması geçti." : `✗ ${failures} kontrol BAŞARISIZ.`);
  } finally {
    if (proc.pid !== undefined) {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // süreç grubu zaten sonlanmışsa yoksay
      }
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
