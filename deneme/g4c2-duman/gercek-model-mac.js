// G4C-2 — HAKEM_MODU=workersAi gerçek model sınaması: EN FAZLA 20 çağrı,
// 1 kısa maç (turnLimit=5, rol=avci, uzmanlık=[] -> taban kota 1 mesaj/tur).

const BASE = process.env.AK_BASE_URL;
const API_KEY = process.env.AK_API_KEY;
if (!BASE || !API_KEY) {
  throw new Error("AK_BASE_URL ve AK_API_KEY ortam değişkenleri gerekli.");
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
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
  return { status: res.status, body };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const created = await call("/matches", {
    method: "POST",
    body: JSON.stringify({ rol: "avci", uzmanlik: [], turnLimit: 5 }),
  });
  if (created.status !== 201) {
    throw new Error(`POST /matches failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const matchId = created.body.matchId;
  let view = created.body.view;
  let status = created.body.status;
  console.log(`Maç ${matchId} oluşturuldu, turSiniri=${view.turSiniri}`);

  const TERMINAL = ["avciKazandi", "kacakKazandi"];
  let turns = 0;
  while (!TERMINAL.includes(status) && turns < 5) {
    turns += 1;
    const moveBody =
      Array.isArray(view.komsular) && view.komsular.length > 0
        ? { type: "git", to: pickRandom(view.komsular) }
        : { type: "yakala" };
    const result = await call(`/matches/${matchId}/move`, {
      method: "POST",
      body: JSON.stringify({ move: moveBody }),
    });
    if (result.status !== 200) {
      console.log(`tur ${turns}: FAILED status=${result.status} body=${JSON.stringify(result.body)}`);
      break;
    }
    view = result.body.view;
    status = result.body.status;
    console.log(
      `tur ${turns}: durum=${status} hakemMesajlari=${JSON.stringify(result.body.hakemMesajlari ?? [])}`
    );
  }

  const record = await call(`/matches/${matchId}/record`);
  console.log(`\nKayıt status=${record.status}`);
  if (record.status === 200) {
    console.log(`final=${record.body.status} kayitliTur=${record.body.turns.length}`);
    const olaylar = record.body.olaylar ?? record.body.turns.flatMap((t) => t.olaylar ?? []);
    console.log(`olaylar=${JSON.stringify(olaylar)}`);
  }
  console.log(`\nmatchId=${matchId} toplamTur=${turns}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
