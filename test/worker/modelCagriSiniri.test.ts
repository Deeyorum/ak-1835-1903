import { spawn, execSync, type ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";

/**
 * G4B-1b — Madde 4: maç başına model çağrısı üst sınırı, yerel
 * `wrangler dev` + yerel D1 üzerinden uçtan uca (bkz. test/worker/
 * kalisiKota.test.ts'deki AYNI harness deseni — KÜÇÜK bir sınır
 * `--var` ile ezilir, wrangler.toml'daki 40'ı DEĞİL).
 *
 * Doğrulanan sözleşme (Madde 4, DEFTER.md "G4B-1b"):
 *   - Sınır aşıldığında sabit yanıt döner (gerçek hakem/model ÇAĞRILMAZ).
 *   - Olay maç kaydına (`rejected`) yazılır.
 *   - Maç DÜŞMEZ: durum "devam" kalır, yanıt 200'dür (400/409 DEĞİL).
 */

const PROJE_KOKU = path.join(__dirname, "../..");
const PORT = 8803;
const TABAN = `http://localhost:${PORT}`;
const KUCUK_SINIR = 2;

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
        `MAC_MODEL_CAGRI_SINIRI:${KUCUK_SINIR}`,
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

function macDurumunuOku(macId: string): string {
  const ham = execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --json --command="SELECT status FROM matches WHERE id='${macId}'"`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  ).toString("utf-8");
  const sonuc = JSON.parse(ham);
  return sonuc[0].results[0].status as string;
}

const DOGRU_CEVAPLAR = {
  "kal-hamlesi": "kal",
  "sor-hakeme-hamlesi": "sorHakeme",
  "yakala-hamlesi": "yakala",
  "en-cok-uzmanlik": "2",
  "yanlis-yakalama": "evet",
};

async function main() {
  console.log(`=== G4B-1b Madde 4: model çağrısı sınırı sınaması (sınır=${KUCUK_SINIR}) ===\n`);

  console.log("Yerel D1 sıfırlanıyor, şema + migration uygulanıyor...");
  yerelD1SifirlaVeSemayiUygula();

  console.log("wrangler dev başlatılıyor (yalnız yerel, --remote YOK)...");
  const proc = await wranglerDevBaslat();
  console.log("Hazır.\n");

  try {
    const kayit = await istekAt("/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "model-cagri-sinama-botu" }),
    });
    const apiKey = kayit.gövde.apiKey as string;
    const yetki = { Authorization: `Bearer ${apiKey}` };

    await istekAt("/exam", {
      method: "POST",
      headers: { ...yetki, "Content-Type": "application/json" },
      body: JSON.stringify({ cevaplar: DOGRU_CEVAPLAR }),
    });

    const mac = await istekAt("/matches", {
      method: "POST",
      headers: { ...yetki, "Content-Type": "application/json" },
      body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 10 }),
    });
    const macId = mac.gövde.matchId as string;

    // Sınır kadar sorHakeme GÖNDER — hepsi gerçek (sabit olmayan,
    // dilim-şablonlu) yanıt almalı.
    for (let i = 0; i < KUCUK_SINIR; i++) {
      const hamle = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ move: { type: "sorHakeme", mesaj: "What do you know?" } }),
      });
      kontrol(
        `sınır İÇİNDE çağrı ${i + 1}/${KUCUK_SINIR} kabul edildi (200)`,
        hamle.status === 200,
        `durum=${hamle.status}`
      );
    }

    // Sınırı AŞAN bir çağrı — maç DÜŞMEMELİ (200, durum=devam), ama
    // yanıt SABİT olmalı ve `rejected` alanında olay görünmeli.
    const asanHamle = await istekAt(`/matches/${macId}/move`, {
      method: "POST",
      headers: { ...yetki, "Content-Type": "application/json" },
      body: JSON.stringify({ move: { type: "sorHakeme", mesaj: "What do you know?" } }),
    });
    kontrol(
      "sınır aşıldığında maç DÜŞMEZ (200 döner, 400/409 DEĞİL)",
      asanHamle.status === 200,
      `durum=${asanHamle.status} gövde=${JSON.stringify(asanHamle.gövde)}`
    );
    kontrol(
      "sınır aşıldığında status hâlâ 'devam'dır",
      asanHamle.gövde?.status === "devam",
      String(asanHamle.gövde?.status)
    );
    kontrol(
      "sınır aşımı olayı `rejected` alanında görünür",
      typeof asanHamle.gövde?.rejected === "string" &&
        asanHamle.gövde.rejected.includes("Model çağrısı sınırı aşıldı"),
      String(asanHamle.gövde?.rejected)
    );
    const sonYanit = (asanHamle.gövde?.view?.hakemYanitlari ?? []).at(-1);
    kontrol(
      "sınır aşıldığında hakem/model GERÇEKTEN ÇAĞRILMADI (sabit yanıt döndü)",
      sonYanit?.yanit === "Bu maçta model çağrısı sınırına ulaşıldı, yanıt verilemiyor.",
      JSON.stringify(sonYanit)
    );

    // Maç hâlâ DEVAM EDİYOR mu (D1'den DOĞRUDAN, HTTP'den BAĞIMSIZ)?
    const d1Durum = macDurumunuOku(macId);
    kontrol(
      "D1'deki gerçek maç durumu da 'devam' (HTTP yanıtından BAĞIMSIZ doğrulama)",
      d1Durum === "devam",
      `okunan=${d1Durum}`
    );

    console.log(`\n=== SONUÇ ===`);
    console.log(failures === 0 ? "✓ Model çağrısı sınırı sınaması geçti." : `✗ ${failures} kontrol BAŞARISIZ.`);
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
