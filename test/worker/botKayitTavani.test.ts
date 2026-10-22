import { spawn, execSync, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * G4C-4a-FIX — Madde 2: `POST /bots` günlük (UTC) kayıt tavanı.
 *
 * Tavan koda gömülü bir sabittir (`GUNLUK_BOT_KAYIT_TAVANI=200`,
 * `src/worker/botKayitTavani.ts`), `--var` ile EZİLEMEZ (bkz.
 * test/worker/kalisiKota.test.ts'teki `DAILY_MATCH_QUOTA` gibi bir
 * wrangler.toml değişkeni DEĞİL). 200 gerçek HTTP kaydı yapmak yerine
 * (yavaş), `GUNLUK_BOT_KAYIT_TAVANI-1` satır DOĞRUDAN SQL ile
 * tohumlanır — `created_at` sütunu şemanın varsayılanına
 * (`datetime('now')`) bırakılır, bu yüzden tohum satırları da "bugün"
 * sayılır.
 *
 * NOT: değer burada statik `import` İLE src/worker'dan ALINMAZ —
 * `tsconfig.game.json` Workers tiplerini (`D1Database`, `worker-
 * configuration.d.ts`) İÇERMEZ, bir `import` `typecheck:game`'i
 * kırar (tıpkı bu dosyanın üstündeki `test/olcum` dışlama notundaki
 * AYNI sınıf sorun). Bu yüzden değer burada EL İLE kopyalanır —
 * `src/worker/botKayitTavani.ts`'teki `GUNLUK_BOT_KAYIT_TAVANI` ile
 * SENKRON tutulmalı.
 *
 * Doğrulanan sözleşme:
 *   - Tavanın BİR ALTINDAYKEN kayıt kabul edilir (201).
 *   - Tavana ULAŞINCA yeni kayıt 429 + `Retry-After` döner.
 *   - 429 durumunda `bots` tablosuna HİÇBİR yazma OLMAZ (sayaç sabit).
 */
const GUNLUK_BOT_KAYIT_TAVANI = 200;

const PROJE_KOKU = path.join(__dirname, "../..");
const PORT = 8805;
const TABAN = `http://localhost:${PORT}`;

let failures = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  console.log(`${kosul ? "✓" : "✗"} ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  if (!kosul) failures++;
}

interface FetchYaniti {
  status: number;
  headers: { get(name: string): string | null };
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

/** `adet` sahte bot satırını DOĞRUDAN SQL ile ekler (`created_at` varsayılanı = şimdi/bugün). */
function tohumBotlariEkle(adet: number): void {
  const satirlar: string[] = [];
  for (let i = 0; i < adet; i++) {
    satirlar.push(`('tohum-bot-${i}', 'tohum-bot-${i}', NULL, 'tohum-karma-${i}', 0)`);
  }
  const sql = `INSERT INTO bots (id, name, owner, api_key_hash, exam_passed) VALUES\n${satirlar.join(",\n")};`;
  const tmpDosya = path.join(os.tmpdir(), `ak-1835-1903-tohum-bot-${Date.now()}.sql`);
  fs.writeFileSync(tmpDosya, sql, "utf-8");
  try {
    execSync(`npx --no-install wrangler d1 execute ak-1835-1903 --local --file=${tmpDosya}`, {
      cwd: PROJE_KOKU,
      stdio: "pipe",
    });
  } finally {
    fs.unlinkSync(tmpDosya);
  }
}

function suankiGunUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function botSayisiniOku(): number {
  const gun = suankiGunUtc();
  const ham = execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --json --command="SELECT COUNT(*) as sayac FROM bots WHERE substr(created_at,1,10)='${gun}'"`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  ).toString("utf-8");
  const sonuc = JSON.parse(ham);
  return Number(sonuc[0].results[0].sayac);
}

function wranglerDevBaslat(): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "npx",
      ["--no-install", "wrangler", "dev", "--local", "--port", String(PORT)],
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
): Promise<{ status: number; gövde: any; retryAfter: string | null }> {
  const yanit = (await fetch(`${TABAN}${endpoint}`, init)) as unknown as FetchYaniti;
  const metin = await yanit.text();
  let gövde: any;
  try {
    gövde = JSON.parse(metin);
  } catch {
    gövde = undefined;
  }
  return { status: yanit.status, gövde, retryAfter: yanit.headers.get("Retry-After") };
}

async function main() {
  console.log(
    `=== G4C-4a-FIX Madde 2: günlük bot kayıt tavanı sınaması (tavan=${GUNLUK_BOT_KAYIT_TAVANI}) ===\n`
  );

  console.log("Yerel D1 sıfırlanıyor, şema + migration uygulanıyor...");
  yerelD1SifirlaVeSemayiUygula();

  console.log(`${GUNLUK_BOT_KAYIT_TAVANI - 1} sahte bot satırı SQL ile tohumlanıyor...`);
  tohumBotlariEkle(GUNLUK_BOT_KAYIT_TAVANI - 1);
  const tohumSonrasiSayac = botSayisiniOku();
  kontrol(
    `tohumlama sonrası sayaç = ${GUNLUK_BOT_KAYIT_TAVANI - 1} (tavanın bir altı)`,
    tohumSonrasiSayac === GUNLUK_BOT_KAYIT_TAVANI - 1,
    `okunan=${tohumSonrasiSayac}`
  );

  console.log("wrangler dev başlatılıyor (yalnız yerel, --remote YOK, override YOK — gerçek sabit kullanılıyor)...");
  const proc = await wranglerDevBaslat();
  console.log("Hazır.\n");

  try {
    // Tavanın BİR ALTINDAYKEN kayıt kabul edilmeli (sayaç tavana ULAŞIR).
    const altindaKayit = await istekAt("/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tavan-alti-botu" }),
    });
    kontrol(
      "tavanın bir altındayken kayıt kabul edilir (201)",
      altindaKayit.status === 201,
      // NOT: gövde (apiKey içerir) burada BASILMAZ — yalnız durum kodu.
      `durum=${altindaKayit.status}`
    );

    const tavandaSayac = botSayisiniOku();
    kontrol(
      `kabul sonrası sayaç = ${GUNLUK_BOT_KAYIT_TAVANI} (tavana ULAŞTI)`,
      tavandaSayac === GUNLUK_BOT_KAYIT_TAVANI,
      `okunan=${tavandaSayac}`
    );

    // Tavan DOLU — bir sonraki kayıt 429 almalı, YAZMAMALI.
    const asanKayit = await istekAt("/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tavan-asan-botu" }),
    });
    kontrol(
      "tavan dolunca 429 döner",
      asanKayit.status === 429,
      `durum=${asanKayit.status} gövde=${JSON.stringify(asanKayit.gövde)}`
    );
    kontrol(
      "429 gövdesi mevcut `hataYaniti` biçimindedir (`{ hata: string }`)",
      typeof asanKayit.gövde?.hata === "string",
      JSON.stringify(asanKayit.gövde)
    );
    const retryAfterSayi = Number(asanKayit.retryAfter);
    kontrol(
      "`Retry-After` başlığı pozitif, gün içi (≤86400) bir tam sayıdır",
      asanKayit.retryAfter !== null &&
        Number.isInteger(retryAfterSayi) &&
        retryAfterSayi > 0 &&
        retryAfterSayi <= 86_400,
      `Retry-After=${asanKayit.retryAfter}`
    );

    // YAZMA OLMADI mı? (D1'den DOĞRUDAN, HTTP yanıtından BAĞIMSIZ.)
    const sonSayac = botSayisiniOku();
    kontrol(
      `429 SONRASI sayaç hâlâ ${GUNLUK_BOT_KAYIT_TAVANI} (429'da YAZMA OLMADI)`,
      sonSayac === GUNLUK_BOT_KAYIT_TAVANI,
      `okunan=${sonSayac}`
    );

    console.log(`\n=== SONUÇ ===`);
    console.log(
      failures === 0 ? "✓ Günlük bot kayıt tavanı sınaması geçti." : `✗ ${failures} kontrol BAŞARISIZ.`
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
