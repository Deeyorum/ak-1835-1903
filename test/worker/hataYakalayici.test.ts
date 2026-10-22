import { spawn, execSync, type ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";

/**
 * G4C-4a-FIX — Madde 1: `src/worker/index.ts`'teki global `try/catch`.
 *
 * `--var HAKEM_MODU:workersAi` + `--var AI_MODEL_NAME:PLACEHOLDER_...`
 * ile `src/worker/rotalar/maclar.ts`'teki (yakalanmayan) `throw`
 * DETERMİNİSTİK olarak tetiklenir (bkz. test/worker/modelCagriSiniri.
 * test.ts'teki AYNI harness deseni). Doğrulanan sözleşme:
 *   - İstemci 500 + SABİT, genel JSON gövde alır.
 *   - Gövde iç ayrıntı (hata mesajı metni, model adı, dosya yolu,
 *     "Error"/yığın izi işaretleri) İÇERMEZ.
 *   - Mevcut `hataYaniti` biçimi (`{ hata: string }`) başka bir rotada
 *     (burada `/bots`'un 400'ü) BOZULMADI.
 */

const PROJE_KOKU = path.join(__dirname, "../..");
const PORT = 8804;
const TABAN = `http://localhost:${PORT}`;
const YANLIS_MODEL_ADI = "PLACEHOLDER_TEST_DEGERI";

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
        "HAKEM_MODU:workersAi",
        "--var",
        `AI_MODEL_NAME:${YANLIS_MODEL_ADI}`,
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

async function istekAt(
  endpoint: string,
  init: RequestInit
): Promise<{ status: number; gövde: any; metin: string }> {
  const yanit = (await fetch(`${TABAN}${endpoint}`, init)) as unknown as FetchYaniti;
  const metin = await yanit.text();
  let gövde: any;
  try {
    gövde = JSON.parse(metin);
  } catch {
    gövde = undefined;
  }
  return { status: yanit.status, gövde, metin };
}

const DOGRU_CEVAPLAR = {
  "kal-hamlesi": "kal",
  "sor-hakeme-hamlesi": "sorHakeme",
  "yakala-hamlesi": "yakala",
  "en-cok-uzmanlik": "2",
  "yanlis-yakalama": "evet",
};

async function main() {
  console.log("=== G4C-4a-FIX Madde 1: global hata yakalayıcı sınaması ===\n");

  console.log("Yerel D1 sıfırlanıyor, şema + migration uygulanıyor...");
  yerelD1SifirlaVeSemayiUygula();

  console.log("wrangler dev başlatılıyor (yalnız yerel, --remote YOK, HAKEM_MODU=workersAi + geçersiz AI_MODEL_NAME ile)...");
  const proc = await wranglerDevBaslat();
  console.log("Hazır.\n");

  try {
    const kayit = await istekAt("/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "hata-yakalayici-sinama-botu" }),
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

    // Bu hamle maclar.ts'teki (yakalanmayan) "AI_MODEL_NAME geçerli
    // değil" throw'unu tetikler — artık global catch'e düşmeli.
    const hamle = await istekAt(`/matches/${macId}/move`, {
      method: "POST",
      headers: { ...yetki, "Content-Type": "application/json" },
      body: JSON.stringify({ move: { type: "sorHakeme", mesaj: "What do you know?" } }),
    });

    kontrol("yakalanmayan istisna 500 döner", hamle.status === 500, `durum=${hamle.status}`);
    kontrol(
      "gövde SABİT genel mesajdır",
      hamle.gövde?.hata === "Sunucu hatası.",
      JSON.stringify(hamle.gövde)
    );
    kontrol(
      "gövde yalnız `hata` alanı içerir (ek iç ayrıntı alanı YOK)",
      hamle.gövde !== undefined && Object.keys(hamle.gövde).length === 1 && "hata" in hamle.gövde,
      JSON.stringify(hamle.gövde)
    );
    const SIZMAMASI_GEREKEN_DIZGELER = [
      "AI_MODEL_NAME",
      YANLIS_MODEL_ADI,
      "HAKEM_MODU",
      "ETIKET_SIRRI",
      "at ",
      "src/worker",
      ".ts:",
      "Error:",
    ];
    for (const dizge of SIZMAMASI_GEREKEN_DIZGELER) {
      kontrol(
        `yanıt gövdesi "${dizge}" İÇERMİYOR (iç ayrıntı sızmadı)`,
        !hamle.metin.includes(dizge),
        hamle.metin.length > 200 ? hamle.metin.slice(0, 200) + "..." : hamle.metin
      );
    }

    // Mevcut hata yanıtı biçimi (farklı bir rotanın 400'ü) BOZULMADI mı?
    const kotuGovde = await istekAt("/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    kontrol(
      "mevcut `hataYaniti` biçimi (400, başka bir rota) DEĞİŞMEDİ",
      kotuGovde.status === 400 &&
        kotuGovde.gövde?.hata === "`name` zorunlu ve boş olmayan bir dizge olmalı.",
      JSON.stringify(kotuGovde.gövde)
    );

    // Sunucu, bu istisnadan SONRA da normal çalışıyor mu (süreç çökmedi)?
    const saglik = await istekAt("/health", { method: "GET" });
    kontrol(
      "istisna sonrası /health hâlâ 200 (süreç/worker ÇÖKMEDİ)",
      saglik.status === 200 && saglik.gövde?.status === "ok",
      JSON.stringify(saglik.gövde)
    );

    console.log(`\n=== SONUÇ ===`);
    console.log(
      failures === 0 ? "✓ Global hata yakalayıcı sınaması geçti." : `✗ ${failures} kontrol BAŞARISIZ.`
    );
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
