import { spawn, execSync, type ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";

/**
 * G4B-1 — Kalıcı (D1) günlük maç kotası, yerel `wrangler dev` + yerel
 * D1 üzerinden uçtan uca. `gunlukMacKotasindaMi()` gerçek bir
 * `D1Database` bağlaması gerektirir — bu yalnız Workers çalışma
 * zamanında var olur, Node'dan doğrudan birim sınanamaz (bkz.
 * test/api/api.test.ts'teki aynı kısıt).
 *
 * KÜÇÜK bir kota (--var ile ezilir, wrangler.toml'daki 100'ü DEĞİL)
 * kullanılarak 429'a hızlıca ulaşılır; ardından `bot_gunluk_kota`
 * tablosu DOĞRUDAN SQL ile okunup sayacın KALICI (D1'de) olduğu
 * kanıtlanır — yalnız HTTP yanıtlarına güvenilmez.
 */

const PROJE_KOKU = path.join(__dirname, "../..");
const PORT = 8801;
const TABAN = `http://localhost:${PORT}`;
const KUCUK_KOTA = 3;

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
    const proc = spawn(
      "npx",
      [
        "--no-install",
        "wrangler",
        "dev",
        "--local",
        "--port",
        String(PORT),
        "--var",
        `DAILY_MATCH_QUOTA:${KUCUK_KOTA}`,
      ],
      { cwd: PROJE_KOKU, detached: true }
    );
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

function botGunlukSayaciniOku(botId: string): number {
  const gun = new Date().toISOString().slice(0, 10);
  const ham = execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --json --command="SELECT sayac FROM bot_gunluk_kota WHERE bot_id='${botId}' AND gun='${gun}'"`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  ).toString("utf-8");
  const sonuc = JSON.parse(ham);
  const satirlar = sonuc[0].results;
  return satirlar.length === 0 ? 0 : Number(satirlar[0].sayac);
}

const DOGRU_CEVAPLAR = {
  "kal-hamlesi": "kal",
  "sor-hakeme-hamlesi": "sorHakeme",
  "yakala-hamlesi": "yakala",
  "en-cok-uzmanlik": "2",
  "yanlis-yakalama": "evet",
};

async function main() {
  console.log(`=== G4B-1: kalıcı (D1) günlük maç kotası sınaması (kota=${KUCUK_KOTA}) ===\n`);

  console.log("Yerel D1 sıfırlanıyor, şema + migration uygulanıyor...");
  yerelD1SifirlaVeSemayiUygula();

  console.log("wrangler dev başlatılıyor (yalnız yerel, --remote YOK)...");
  const proc = await wranglerDevBaslat();
  console.log("Hazır.\n");

  try {
    const kayit = await istekAt("/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "kota-sinama-botu" }),
    });
    const botId = kayit.gövde.botId as string;
    const apiKey = kayit.gövde.apiKey as string;
    const yetkiBasligi = { Authorization: `Bearer ${apiKey}` };

    await istekAt("/exam", {
      method: "POST",
      headers: { ...yetkiBasligi, "Content-Type": "application/json" },
      body: JSON.stringify({ cevaplar: DOGRU_CEVAPLAR }),
    });

    // Kota kadar maç oluştur — hepsi 201 kabul edilmeli.
    for (let i = 0; i < KUCUK_KOTA; i++) {
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetkiBasligi, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 3 }),
      });
      kontrol(`maç ${i + 1}/${KUCUK_KOTA} kabul edildi (201)`, mac.status === 201, String(mac.status));
    }

    // Kota DOLDU — bir sonraki istek 429 almalı.
    const asanMac = await istekAt("/matches", {
      method: "POST",
      headers: { ...yetkiBasligi, "Content-Type": "application/json" },
      body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 3 }),
    });
    kontrol(
      `kota aşıldıktan sonra 429 dönüyor`,
      asanMac.status === 429,
      `durum=${asanMac.status} gövde=${JSON.stringify(asanMac.gövde)}`
    );

    // KALICILIK KANITI: sayaç D1'de GERÇEKTEN yazılı mı? (yalnız HTTP
    // yanıtına değil, doğrudan SQL'e bakılır.)
    const d1Sayac = botGunlukSayaciniOku(botId);
    kontrol(
      `D1'deki gerçek sayaç = ${KUCUK_KOTA} (HTTP yanıtından BAĞIMSIZ doğrulama)`,
      d1Sayac === KUCUK_KOTA,
      `okunan=${d1Sayac}`
    );

    console.log(`\n=== SONUÇ ===`);
    console.log(failures === 0 ? "✓ Kalıcı kota sınaması geçti." : `✗ ${failures} kontrol BAŞARISIZ.`);
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
