// G4C-2 canlı duman sınaması — taze-goz-g4c1/bot.js'ten uyarlandı.
// Canlı Worker URL'sine karşı, sahte modda Kindi (platform Avcı botu)
// ile 3 Kaçak maçı oynar. Node built-ins only (native fetch).

const BASE = process.env.AK_BASE_URL;
if (!BASE) {
  throw new Error("AK_BASE_URL ortam değişkeni gerekli.");
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, rawText: text };
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

async function registerBot(name) {
  const { status, body } = await call("/bots", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (status !== 201) {
    throw new Error(`/bots failed: ${status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchExam(apiKey) {
  const { status, body } = await call("/exam", { headers: authHeaders(apiKey) });
  if (status !== 200) {
    throw new Error(`GET /exam failed: ${status} ${JSON.stringify(body)}`);
  }
  return body.sorular;
}

const SABIT_CEVAPLAR = {
  "kal-hamlesi": "kal",
  "sor-hakeme-hamlesi": "sorHakeme",
  "yakala-hamlesi": "yakala",
  "en-cok-uzmanlik": "2",
  "yanlis-yakalama": "evet",
};

async function takeExam(apiKey) {
  const sorular = await fetchExam(apiKey);
  const cevaplar = {};
  for (const q of sorular) {
    const cevap = SABIT_CEVAPLAR[q.id];
    if (cevap === undefined) {
      throw new Error(`Bilinmeyen sınav sorusu id=${q.id}`);
    }
    cevaplar[q.id] = cevap;
  }
  const { status, body } = await call("/exam", {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ cevaplar }),
  });
  if (status !== 200) {
    throw new Error(`POST /exam failed: ${status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function createMatch(apiKey, rol, uzmanlik = []) {
  const { status, body } = await call("/matches", {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ rol, uzmanlik }),
  });
  if (status !== 201) {
    throw new Error(`POST /matches failed: ${status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function move(apiKey, matchId, moveBody) {
  const { status, body, rawText } = await call(`/matches/${matchId}/move`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ move: moveBody }),
  });
  return { status, body, rawText };
}

async function getRecord(apiKey, matchId) {
  return call(`/matches/${matchId}/record`, { headers: authHeaders(apiKey) });
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const TERMINAL_STATUSES = ["avciKazandi", "kacakKazandi"];

// Sızıntı taraması: bu dizgeler Kaçak'ın GÖRÜNÜM alanları DIŞINDA
// (örn. ham hakem mesajı metninde Avcı'ya sızan sayfa başlığı gibi)
// görünmemeli. Basit regresyon kontrolü — G4B-3b'nin kapsamlı süzgeç
// taramasının yerine geçmez.
function sizintiTaramasiYap(rawText, context) {
  const supheliler = [];
  if (/CLOUDFLARE|api[_-]?key|Bearer [A-Za-z0-9._-]{20,}/i.test(rawText)) {
    supheliler.push("olasi-kimlik-bilgisi-sizintisi");
  }
  if (supheliler.length > 0) {
    console.log(`  [SIZINTI UYARISI] ${context}: ${supheliler.join(", ")}`);
  }
  return supheliler;
}

async function playKacakMatch(apiKey, index, turnCap = 40) {
  const created = await createMatch(apiKey, "kacak", []);
  const matchId = created.matchId;
  let view = created.view;
  let status = created.status;
  let turns = 0;
  let sizintiSayisi = 0;

  console.log(`\n--- Maç ${index} (${matchId}, rol=kacak, Kindi=avci) ---`);
  console.log(`Başlangıç: ${view.kendiKonum}, turSiniri=${view.turSiniri}`);

  while (!TERMINAL_STATUSES.includes(status) && turns < turnCap) {
    turns += 1;
    const moveBody =
      Array.isArray(view.komsular) && view.komsular.length > 0
        ? { type: "git", to: pickRandom(view.komsular) }
        : { type: "kal" };

    const result = await move(apiKey, matchId, moveBody);
    if (result.status !== 200) {
      console.log(`  tur ${turns}: move BAŞARISIZ status=${result.status} body=${JSON.stringify(result.body)}`);
      break;
    }
    sizintiSayisi += sizintiTaramasiYap(result.rawText, `maç ${index} tur ${turns}`).length;
    view = result.body.view;
    status = result.body.status;
  }

  console.log(`Maç ${matchId} bitti: status=${status}, oynanan tur=${turns}, sızıntı=${sizintiSayisi}`);
  return { matchId, finalStatus: status, turns, sizintiSayisi };
}

async function main() {
  console.log(`BASE=${BASE}`);
  console.log("Bot kaydediliyor...");
  const { botId, apiKey } = await registerBot("g4c2-duman-bot");
  console.log(`botId=${botId}`);

  console.log("Giriş sınavı çözülüyor...");
  const examResult = await takeExam(apiKey);
  console.log("Sınav sonucu:", JSON.stringify(examResult));
  if (examResult.gecti !== true) {
    throw new Error("Sınav geçilemedi, /matches'e geçilemez.");
  }

  const summaries = [];
  for (let i = 1; i <= 3; i++) {
    summaries.push(await playKacakMatch(apiKey, i));
  }

  console.log("\n=== Maç kayıtları ===");
  for (const s of summaries) {
    const { status, body } = await getRecord(apiKey, s.matchId);
    if (status === 200) {
      console.log(`${s.matchId}: final=${body.status} seed=${body.seed} turSiniri=${body.turnLimit} kayitliTur=${body.turns.length}`);
    } else {
      console.log(`${s.matchId}: record alınamadı status=${status}`);
    }
  }

  console.log("\n=== Özet ===");
  let toplamSizinti = 0;
  for (const s of summaries) {
    toplamSizinti += s.sizintiSayisi;
    console.log(`${s.matchId}: finalStatus=${s.finalStatus} turns=${s.turns} sizinti=${s.sizintiSayisi}`);
  }
  console.log(`\nTOPLAM SIZINTI: ${toplamSizinti}`);
  console.log(`BOT_ID_ICIN_SINAV_DOGRULAMASI=${botId}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
