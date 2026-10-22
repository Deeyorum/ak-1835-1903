import { spawn, execSync, type ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";

/**
 * B (goal: "istek boyutu ile dizi uzunluğu üst sınırı") — yerel
 * `wrangler dev` + yerel D1 üzerinden uçtan uca (bkz.
 * test/worker/hakemMesajlari.test.ts ile AYNI harness deseni).
 *
 * Doğrulanan sözleşme:
 *   - `hakemMesajlari` dizisi `MAX_PANEL` (10, src/game/hakemPanel.ts)'den
 *     fazla öğe içeremez — aşımda 400, kota kontrolü VE döngüden ÖNCE
 *     (11. öğe biçimsiz olsa bile AYNI hata döner — sıra kanıtı).
 *   - İstek gövdesi `ISTEK_GOVDESI_BAYT_SINIRI` (45056 bayt,
 *     src/worker/http.ts) aşamaz — aşımda 413, genel JSON `{hata: ...}`;
 *     JSON hiç ayrıştırılmaz (POST /bots'ta da AYNI davranış — http.ts
 *     seviyesinde paylaşılan kontrol, rotaya özel değil).
 *   - İkisinde de tur TÜKETİLMEZ / D1'e yazma OLMAZ.
 */

const PROJE_KOKU = path.join(__dirname, "../..");
const PORT = 8806;
const TABAN = `http://localhost:${PORT}`;
const ISTEK_GOVDESI_BAYT_SINIRI = 45056;

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

function botSayisiniOku(): number {
  const ham = execSync(
    `npx --no-install wrangler d1 execute ak-1835-1903 --local --json --command="SELECT COUNT(*) as n FROM bots"`,
    { cwd: PROJE_KOKU, stdio: "pipe" }
  ).toString("utf-8");
  const sonuc = JSON.parse(ham);
  return sonuc[0].results[0].n as number;
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
  console.log(`=== B: istek boyutu + hakemMesajlari dizi uzunluğu sınırı sınaması ===\n`);

  console.log("Yerel D1 sıfırlanıyor, şema + migration uygulanıyor...");
  yerelD1SifirlaVeSemayiUygula();

  console.log("wrangler dev başlatılıyor (yalnız yerel, --remote YOK)...");
  const proc = await wranglerDevBaslat();
  console.log("Hazır.\n");

  try {
    // --- 1) hakemMesajlari dizisi MAX_PANEL(10)'dan fazla öğe içerirse
    // 400 ile reddedilir — 11. öğe BİÇİMSİZ olsa bile AYNI hata (sıra
    // kanıtı: uzunluk kontrolü döngüden/içerik doğrulamasından ÖNCE). ---
    {
      const { apiKey } = await botKurVeYetkiAl("b-dizi-asimi");
      const yetki = { Authorization: `Bearer ${apiKey}` };
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 10 }),
      });
      const macId = mac.gövde.matchId as string;
      const komsu = mac.gövde.view.komsular[0];
      const turOnce = macTurunuOku(macId);

      const onBirOge: unknown[] = Array.from({ length: 10 }, () => ({ mesaj: "x", hakemId: "sistem" }));
      onBirOge.push({ mesaj: 42 }); // 11. öğe BİÇİMSİZ (mesaj string değil)

      const asanDizi = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ move: { type: "git", to: komsu }, hakemMesajlari: onBirOge }),
      });
      kontrol(
        "11 öğeli hakemMesajlari 400 ile reddedilir",
        asanDizi.status === 400,
        `durum=${asanDizi.status} gövde=${JSON.stringify(asanDizi.gövde)}`
      );
      kontrol(
        "hata mesajı dizi UZUNLUĞU sınırını bildirir (11. öğenin biçim hatası DEĞİL — sıra kanıtı)",
        typeof asanDizi.gövde?.hata === "string" && asanDizi.gövde.hata.includes("en fazla 10 öğe"),
        asanDizi.gövde?.hata
      );

      const turSonra = macTurunuOku(macId);
      kontrol(
        "dizi uzunluğu aşımı tur TÜKETMEMİŞ",
        turSonra === turOnce,
        `önce=${turOnce} sonra=${turSonra}`
      );
    }

    // --- 2) Tam MAX_PANEL(10) öğe dizi-uzunluğu katından GEÇER (400
    // "en fazla 10 öğe" DEĞİL) — mevcut kota formülü (taban 1) bunu
    // FARKLI bir mesajla (kota aşımı) reddeder; bu da dizi-uzunluğu
    // kontrolünün kota kontrolünden ÖNCE ve BAĞIMSIZ çalıştığını
    // kanıtlar. ---
    {
      const { apiKey } = await botKurVeYetkiAl("b-dizi-tam-10");
      const yetki = { Authorization: `Bearer ${apiKey}` };
      const mac = await istekAt("/matches", {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 10 }),
      });
      const macId = mac.gövde.matchId as string;
      const komsu = mac.gövde.view.komsular[0];

      const onOge = Array.from({ length: 10 }, () => ({ mesaj: "x", hakemId: "sistem" }));
      const hamle = await istekAt(`/matches/${macId}/move`, {
        method: "POST",
        headers: { ...yetki, "Content-Type": "application/json" },
        body: JSON.stringify({ move: { type: "git", to: komsu }, hakemMesajlari: onOge }),
      });
      kontrol(
        "tam 10 öğe dizi-uzunluğu katından GEÇER, kota mesajıyla reddedilir (farklı hata)",
        hamle.status === 400 && typeof hamle.gövde?.hata === "string" && hamle.gövde.hata.includes("kota"),
        `durum=${hamle.status} gövde=${JSON.stringify(hamle.gövde)}`
      );
    }

    // --- 3) İstek gövdesi bayt sınırını aşarsa 413 + genel JSON döner,
    // JSON hiç ayrıştırılmaz (POST /bots — http.ts seviyesinde paylaşılan
    // kontrol, rotaya özel değil). ---
    {
      const buyukGovde = JSON.stringify({
        name: "b-bayt-asimi",
        asimIcinDolgu: "x".repeat(ISTEK_GOVDESI_BAYT_SINIRI + 1000),
      });
      const botSayisiOnce = botSayisiniOku();
      const asanIstek = await istekAt("/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buyukGovde,
      });
      kontrol(
        "istek gövdesi bayt sınırını aşınca 413 döner",
        asanIstek.status === 413,
        `durum=${asanIstek.status} gövde=${JSON.stringify(asanIstek.gövde)}`
      );
      kontrol(
        "413 gövdesi genel JSON `{hata: ...}` biçiminde, sınır sayısını bildirir",
        typeof asanIstek.gövde?.hata === "string" &&
          asanIstek.gövde.hata.includes(String(ISTEK_GOVDESI_BAYT_SINIRI)),
        asanIstek.gövde?.hata
      );
      const botSayisiSonra = botSayisiniOku();
      kontrol(
        "aşan istek hiçbir bot KAYDETMEMİŞ (JSON hiç ayrıştırılmadan reddedildi)",
        botSayisiSonra === botSayisiOnce,
        `önce=${botSayisiOnce} sonra=${botSayisiSonra}`
      );
    }

    // --- 4) Sınır İÇİNDEKİ normal bir istek hâlâ ÇALIŞIR (regresyon). ---
    {
      const normalIstek = await istekAt("/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "b-normal-govde" }),
      });
      kontrol(
        "sınır içindeki normal istek hâlâ 201 döner (regresyon yok)",
        normalIstek.status === 201,
        `durum=${normalIstek.status}`
      );
    }

    console.log(`\n=== SONUÇ ===`);
    console.log(
      failures === 0
        ? "✓ İstek boyutu + dizi uzunluğu sınırı sınaması geçti."
        : `✗ ${failures} kontrol BAŞARISIZ.`
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
