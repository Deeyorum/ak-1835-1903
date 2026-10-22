// G4C-4 (YUK-4C-2) — deneme/g4c3-yuk/yuk-sinamasi.js'in CANLI kopyası.
// Kaynak DEĞİŞTİRİLMEDİ, bu AYRI bir dosya. Tek fark: taban adres artık
// AK_BASE_URL ortam değişkeninden okunur (yoksa/yanlışsa hiçbir istek
// atmadan çıkar), en fazla 5 bot kaydedilip maçlar arasında yeniden
// kullanılır, ve her isteğin durum kodu + süresi bellekte tutulup
// sonda özetlenir. Oyun mantığı, uç nokta çağrıları ve sınav akışı
// kaynak betikle AYNI.

const BEKLENEN_CANLI_ADRES = "https://ak-1835-1903.tthacktt.workers.dev";
const BASE = process.env.AK_BASE_URL;

if (BASE === undefined || BASE !== BEKLENEN_CANLI_ADRES) {
  console.log(
    `AK_BASE_URL tanımsız ya da beklenen canlı adresle (${BEKLENEN_CANLI_ADRES}) eşleşmiyor — HİÇBİR İSTEK ATILMADAN çıkılıyor.`
  );
  console.log(`AK_BASE_URL=${BASE === undefined ? "(tanımsız)" : "(başka bir değer, yazılmıyor)"}`);
  process.exit(0);
}

const TURN_LIMIT = 10;
const BOT_SAYISI = 5;
const ARDISIK_MAC_SAYISI = 25;
const ESZAMANLI_MAC_SAYISI = 5;

const SABIT_CEVAPLAR = {
  "kal-hamlesi": "kal",
  "sor-hakeme-hamlesi": "sorHakeme",
  "yakala-hamlesi": "yakala",
  "en-cok-uzmanlik": "2",
  "yanlis-yakalama": "evet",
};

const TERMINAL = ["avciKazandi", "kacakKazandi"];

// --- DUR durumu (madde 2) — tüm eşzamanlı çağrılar bu PAYLAŞILAN nesneyi okur/yazar. ---
const durum = {
  durduruldu: false,
  nedeni: null,
  ardasik5xx: 0,
};

// --- Tüm isteklerin özeti (madde 3) — apiKey/32-karakterlik değer İÇERMEZ. ---
const tumIstekler = []; // { adim, status, ms }

/** Hassas görünen (apiKey "akb_" önekli 68 karakter, ya da 32+ hex karakterlik) dizgeleri loglamadan ÖNCE kırpar. */
function redakteEt(deger) {
  if (typeof deger !== "string") return deger;
  if (/^akb_[0-9a-f]{64}$/.test(deger)) return "[apiKey REDAKTE]";
  if (/^[0-9a-f-]{32,}$/i.test(deger) && deger.replace(/-/g, "").length >= 32) {
    return `[REDAKTE, uzunluk=${deger.length}]`;
  }
  return deger;
}

function govdeyiRedakteEt(govde) {
  if (govde === null || typeof govde !== "object") return govde;
  const kopya = Array.isArray(govde) ? [...govde] : { ...govde };
  for (const anahtar of Object.keys(kopya)) {
    if (anahtar === "apiKey") {
      kopya[anahtar] = "[apiKey REDAKTE]";
    } else if (typeof kopya[anahtar] === "string") {
      kopya[anahtar] = redakteEt(kopya[anahtar]);
    }
  }
  return kopya;
}

/** 1101 benzeri bir Cloudflare iç hatası (genelde JSON OLMAYAN bir hata sayfası) var mı? */
function biniBirYuzBirBenzeriMi(hamMetin) {
  return typeof hamMetin === "string" && /1101/.test(hamMetin);
}

async function call(adim, path, opts = {}) {
  if (durum.durduruldu) {
    return { status: 0, body: null, atlandi: true };
  }
  const t0 = performance.now();
  let res;
  let hamMetin;
  try {
    res = await fetch(BASE + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    hamMetin = await res.text();
  } catch (e) {
    // Ağ seviyesinde hata (bağlantı koptu vb.) — 5xx'le AYNI şekilde say.
    const t1 = performance.now();
    tumIstekler.push({ adim, status: 599, ms: t1 - t0 });
    durum.ardasik5xx += 1;
    if (durum.ardasik5xx >= 3) {
      durum.durduruldu = true;
      durum.nedeni = "arka arkaya 3 adet 5xx (ağ hatası dahil)";
    }
    return { status: 599, body: null, hata: String(e && e.message) };
  }
  const t1 = performance.now();
  const status = res.status;
  tumIstekler.push({ adim, status, ms: t1 - t0 });

  if (biniBirYuzBirBenzeriMi(hamMetin)) {
    durum.durduruldu = true;
    durum.nedeni = "1101 benzeri hata görüldü";
  } else if (status === 429) {
    durum.durduruldu = true;
    durum.nedeni = "429 görüldü";
  } else if (status >= 500) {
    durum.ardasik5xx += 1;
    if (durum.ardasik5xx >= 3) {
      durum.durduruldu = true;
      durum.nedeni = "arka arkaya 3 adet 5xx";
    }
  } else {
    durum.ardasik5xx = 0;
  }

  let body;
  try {
    body = JSON.parse(hamMetin);
  } catch {
    body = hamMetin;
  }
  return { status, body };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Bir bot kaydeder ve sınavı geçirir. Döner: { apiKey, hatalar } (apiKey undefined ise başarısız). */
async function botHazirla(index) {
  const hatalar = [];
  const reg = await call("bots", "/bots", {
    method: "POST",
    body: JSON.stringify({ name: `yuk-test-${index}` }),
  });
  if (reg.status !== 201) {
    hatalar.push({ adim: "bots", status: reg.status, body: govdeyiRedakteEt(reg.body) });
    return { apiKey: undefined, hatalar };
  }
  const apiKey = reg.body.apiKey;
  const auth = { Authorization: `Bearer ${apiKey}` };

  const exam = await call("exam", "/exam", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ cevaplar: SABIT_CEVAPLAR }),
  });
  if (exam.status !== 200 || exam.body?.gecti !== true) {
    hatalar.push({ adim: "exam", status: exam.status, body: govdeyiRedakteEt(exam.body) });
    return { apiKey: undefined, hatalar };
  }

  return { apiKey, hatalar };
}

/** Hazır bir botla tek bir Kaçak maçı oynar. */
async function birMacOyna(apiKey, etiket) {
  const hatalar = [];
  const turSureleriMs = [];
  if (durum.durduruldu) return { hatalar, turSureleriMs, oynanmadi: true };

  const auth = { Authorization: `Bearer ${apiKey}` };
  const created = await call("matches-create", "/matches", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ rol: "kacak", uzmanlik: [], turnLimit: TURN_LIMIT }),
  });
  if (created.status !== 201) {
    if (!durum.durduruldu) {
      hatalar.push({ adim: "matches-create", status: created.status, body: govdeyiRedakteEt(created.body) });
    }
    return { hatalar, turSureleriMs };
  }

  let view = created.body.view;
  let status = created.body.status;
  let turns = 0;

  while (!TERMINAL.includes(status) && turns < TURN_LIMIT && !durum.durduruldu) {
    turns += 1;
    const moveBody =
      Array.isArray(view.komsular) && view.komsular.length > 0
        ? { type: "git", to: pickRandom(view.komsular) }
        : { type: "kal" };

    const result = await call("move", `/matches/${created.body.matchId}/move`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ move: moveBody }),
    });

    if (result.atlandi) break;
    if (result.status !== 200) {
      hatalar.push({ adim: "move", tur: turns, status: result.status, body: govdeyiRedakteEt(result.body) });
      break;
    }
    turSureleriMs.push(result.ms ?? null);
    view = result.body.view;
    status = result.body.status;
  }

  return { hatalar, turSureleriMs };
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return NaN;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[Math.max(0, idx)];
}

function ozetle() {
  const durumKoduDagilimi = {};
  for (const istek of tumIstekler) {
    const anahtar =
      istek.status === 200 ? "200" :
      istek.status === 201 ? "201" :
      istek.status === 400 ? "400" :
      istek.status === 413 ? "413" :
      istek.status === 429 ? "429" :
      istek.status >= 500 ? "5xx" :
      String(istek.status);
    durumKoduDagilimi[anahtar] = (durumKoduDagilimi[anahtar] ?? 0) + 1;
  }
  const sureler = tumIstekler.map((i) => i.ms).sort((a, b) => a - b);
  return {
    toplamIstek: tumIstekler.length,
    durumKoduDagilimi,
    sureMs: {
      ortanca: percentile(sureler, 50),
      p95: percentile(sureler, 95),
      enBuyuk: sureler[sureler.length - 1],
    },
    durduruldu: durum.durduruldu,
    durdurmaNedeni: durum.nedeni,
  };
}

async function main() {
  const baslangicUtc = new Date().toISOString();
  console.log(`Başlangıç (UTC): ${baslangicUtc}`);
  console.log(`Taban adres: ${BASE}`);

  console.log(`\n${BOT_SAYISI} bot hazırlanıyor (yuk-test- önekiyle)...`);
  const botlar = [];
  for (let i = 0; i < BOT_SAYISI; i++) {
    if (durum.durduruldu) break;
    const { apiKey, hatalar } = await botHazirla(i);
    if (hatalar.length > 0) {
      console.log(`  bot ${i}: HATA (${JSON.stringify(hatalar)})`);
    }
    if (apiKey !== undefined) botlar.push(apiKey);
  }
  console.log(`  hazır bot sayısı: ${botlar.length}/${BOT_SAYISI}`);

  if (botlar.length === 0) {
    console.log("\nHiçbir bot hazırlanamadı — yük BAŞLATILAMADI.");
  } else if (!durum.durduruldu) {
    console.log(`\n${ARDISIK_MAC_SAYISI} ardışık maç başlıyor...`);
    for (let i = 0; i < ARDISIK_MAC_SAYISI && !durum.durduruldu; i++) {
      const apiKey = botlar[i % botlar.length];
      await birMacOyna(apiKey, `ardisik-${i}`);
    }
    if (durum.durduruldu) {
      console.log(`  DUR tetiklendi: ${durum.nedeni} — ardışık fazda kesildi.`);
    }

    if (!durum.durduruldu) {
      console.log(`\n${ESZAMANLI_MAC_SAYISI} eşzamanlı maç başlıyor...`);
      const promises = [];
      for (let i = 0; i < ESZAMANLI_MAC_SAYISI; i++) {
        const apiKey = botlar[i % botlar.length];
        promises.push(birMacOyna(apiKey, `eszamanli-${i}`));
      }
      await Promise.all(promises);
      if (durum.durduruldu) {
        console.log(`  DUR tetiklendi: ${durum.nedeni} — eşzamanlı fazda kesildi.`);
      }
    } else {
      console.log("\nEşzamanlı faz BAŞLATILMADI (ardışık fazda zaten DUR tetiklendi).");
    }
  } else {
    console.log("\nBot hazırlama sırasında DUR tetiklendi — maç fazları BAŞLATILMADI.");
  }

  const bitisUtc = new Date().toISOString();
  console.log(`\nBitiş (UTC): ${bitisUtc}`);

  const ozet = ozetle();
  console.log("\n=== SONUÇ (YUK-4C-2) ===");
  console.log(JSON.stringify({ baslangicUtc, bitisUtc, ...ozet }, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", redakteEt(String(err && err.message)));
  process.exit(1);
});
