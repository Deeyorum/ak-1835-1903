// G4C-3 Madde 4 — yerel yük sınaması. wrangler dev --local karşısında,
// HAKEM_MODU=sahte (ağa çıkmaz), 50 ardışık + 5 eşzamanlı Kaçak maçı.
// Her maç kendi botunu kaydeder (dakikalık hız sınırını, 30 istek/dk/bot,
// bir maçın içinde tüketmemek için) — ölçülen şey tur gecikmesi, hız
// sınırlayıcının davranışı değil.

const BASE = "http://localhost:8787";
const TURN_LIMIT = 10;

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const SABIT_CEVAPLAR = {
  "kal-hamlesi": "kal",
  "sor-hakeme-hamlesi": "sorHakeme",
  "yakala-hamlesi": "yakala",
  "en-cok-uzmanlik": "2",
  "yanlis-yakalama": "evet",
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const TERMINAL = ["avciKazandi", "kacakKazandi"];

/** Bir bot kaydeder, sınavı geçer, bir Kaçak maçı oynar. Döner: {hatalar, turSureleriMs}. */
async function birMacOyna(index) {
  const hatalar = [];
  const turSureleriMs = [];

  const reg = await call("/bots", { method: "POST", body: JSON.stringify({ name: `g4c3-yuk-${index}` }) });
  if (reg.status !== 201) {
    hatalar.push({ adim: "bots", status: reg.status, body: reg.body });
    return { hatalar, turSureleriMs };
  }
  const apiKey = reg.body.apiKey;
  const auth = { Authorization: `Bearer ${apiKey}` };

  const exam = await call("/exam", { method: "POST", headers: auth, body: JSON.stringify({ cevaplar: SABIT_CEVAPLAR }) });
  if (exam.status !== 200 || exam.body.gecti !== true) {
    hatalar.push({ adim: "exam", status: exam.status, body: exam.body });
    return { hatalar, turSureleriMs };
  }

  const created = await call("/matches", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ rol: "kacak", uzmanlik: [], turnLimit: TURN_LIMIT }),
  });
  if (created.status !== 201) {
    hatalar.push({ adim: "matches-create", status: created.status, body: created.body });
    return { hatalar, turSureleriMs };
  }

  let view = created.body.view;
  let status = created.body.status;
  let turns = 0;

  while (!TERMINAL.includes(status) && turns < TURN_LIMIT) {
    turns += 1;
    const moveBody =
      Array.isArray(view.komsular) && view.komsular.length > 0
        ? { type: "git", to: pickRandom(view.komsular) }
        : { type: "kal" };

    const t0 = performance.now();
    const result = await call(`/matches/${created.body.matchId}/move`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ move: moveBody }),
    });
    const t1 = performance.now();

    if (result.status !== 200) {
      hatalar.push({ adim: "move", tur: turns, status: result.status, body: result.body });
      break;
    }
    turSureleriMs.push(t1 - t0);
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

function ozetle(etiket, sonuclar) {
  const hepsiHatalar = sonuclar.flatMap((s) => s.hatalar);
  const hepsiTurSureleri = sonuclar.flatMap((s) => s.turSureleriMs).sort((a, b) => a - b);
  console.log(`\n=== ${etiket} ===`);
  console.log(`maç sayısı: ${sonuclar.length}`);
  console.log(`hata sayısı: ${hepsiHatalar.length}`);
  if (hepsiHatalar.length > 0) {
    console.log(`hata örnekleri (ilk 5): ${JSON.stringify(hepsiHatalar.slice(0, 5))}`);
  }
  console.log(`toplam tur (başarılı move) sayısı: ${hepsiTurSureleri.length}`);
  console.log(`tur süresi p50: ${percentile(hepsiTurSureleri, 50).toFixed(2)} ms`);
  console.log(`tur süresi p99: ${percentile(hepsiTurSureleri, 99).toFixed(2)} ms`);
  console.log(`tur süresi min/max: ${hepsiTurSureleri[0]?.toFixed(2)} / ${hepsiTurSureleri[hepsiTurSureleri.length - 1]?.toFixed(2)} ms`);
  return { hataSayisi: hepsiHatalar.length, p50: percentile(hepsiTurSureleri, 50), p99: percentile(hepsiTurSureleri, 99) };
}

async function main() {
  console.log("50 ardışık maç başlıyor...");
  const ardisikSonuclar = [];
  for (let i = 0; i < 50; i++) {
    ardisikSonuclar.push(await birMacOyna(`ardisik-${i}`));
  }
  const ardisikOzet = ozetle("50 ARDIŞIK MAÇ", ardisikSonuclar);

  console.log("\n5 eşzamanlı maç başlıyor...");
  const esZamanliPromises = [];
  for (let i = 0; i < 5; i++) {
    esZamanliPromises.push(birMacOyna(`eszamanli-${i}`));
  }
  const esZamanliSonuclar = await Promise.all(esZamanliPromises);
  const esZamanliOzet = ozetle("5 EŞZAMANLI MAÇ", esZamanliSonuclar);

  console.log("\n=== SONUÇ (G4C-3 Madde 4) ===");
  console.log(JSON.stringify({ ardisik: ardisikOzet, esZamanli: esZamanliOzet }, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
