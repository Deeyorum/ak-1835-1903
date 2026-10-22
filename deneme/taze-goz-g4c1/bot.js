// AK-1835-1903 "fresh eyes" test bot.
// Written from README.md + openapi.json + llms.txt ONLY (no source code read).
// Node built-ins only (native fetch), run with: node bot.js

const BASE = "http://localhost:8787";

/** @param {string} path @param {object} [opts] */
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
  return { status: res.status, body };
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
  return body; // { botId, apiKey, not }
}

async function fetchExam(apiKey) {
  const { status, body } = await call("/exam", {
    headers: authHeaders(apiKey),
  });
  if (status !== 200) {
    throw new Error(`GET /exam failed: ${status} ${JSON.stringify(body)}`);
  }
  return body.sorular; // [{id, soru}]
}

/**
 * Answer the entrance exam questions using ONLY what the three docs say
 * about the JSON protocol. This is a hardcoded lookup keyed by question
 * text, because the docs give no schema for "soru" -> answer mapping;
 * we reasoned out each answer by hand from README/openapi.json.
 *
 * FRICTION: there is no documented guarantee that exam question ids/text
 * are stable across runs or across bots. We matched on exact question
 * string, which is fragile. If the question bank changes wording, this
 * breaks silently (no fuzzy fallback attempted here deliberately, to
 * surface the fragility rather than paper over it).
 */
function answerExamQuestion(soru) {
  const knownAnswers = [
    [
      "Kaçak'ın yerinde kalma hamlesinin JSON `type` alanı tam olarak nedir?",
      "kal",
    ],
    [
      "Avcı'nın hakeme soru sorma hamlesinin JSON `type` alanı tam olarak nedir?",
      "sorHakeme",
    ],
    [
      "Avcı'nın Kaçak'ı yakalamayı denediği hamlenin JSON `type` değeri nedir?",
      "yakala",
    ],
    [
      "Bir bot maça katılırken en çok kaç uzmanlık beyan edebilir?",
      "2",
    ],
    [
      "Yanlış bir 'yakala' denemesi turu harcar mı? (evet/hayır)",
      "evet",
    ],
  ];
  const hit = knownAnswers.find(([q]) => q === soru);
  if (hit !== undefined) {
    return hit[1];
  }
  // FRICTION: unrecognized question text. Docs don't specify what to do
  // here; best guess is to not submit a wild guess and instead flag it.
  return undefined;
}

async function takeExam(apiKey) {
  const sorular = await fetchExam(apiKey);
  /** @type {Record<string,string>} */
  const cevaplar = {};
  const unresolved = [];
  for (const q of sorular) {
    const answer = answerExamQuestion(q.soru);
    if (answer === undefined) {
      unresolved.push(q);
      continue;
    }
    cevaplar[q.id] = answer;
  }
  if (unresolved.length > 0) {
    console.log(
      "FRICTION: could not derive answers for:",
      JSON.stringify(unresolved, null, 2)
    );
  }
  const { status, body } = await call("/exam", {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ cevaplar }),
  });
  if (status !== 200) {
    throw new Error(`POST /exam failed: ${status} ${JSON.stringify(body)}`);
  }
  return body; // { gecti: true } or { gecti: false, yanlisSoruIdleri }
}

async function createMatch(apiKey, rol, uzmanlik = [], turnLimit) {
  const payload = { rol, uzmanlik };
  if (turnLimit !== undefined) {
    payload.turnLimit = turnLimit;
  }
  const { status, body } = await call("/matches", {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(payload),
  });
  if (status !== 201) {
    throw new Error(`POST /matches failed: ${status} ${JSON.stringify(body)}`);
  }
  return body; // { matchId, rol, status, view }
}

async function move(apiKey, matchId, moveBody, hakemMesajlari) {
  const payload = { move: moveBody };
  if (hakemMesajlari !== undefined) {
    payload.hakemMesajlari = hakemMesajlari;
  }
  const { status, body } = await call(`/matches/${matchId}/move`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(payload),
  });
  return { status, body };
}

async function getRecord(apiKey, matchId) {
  const { status, body } = await call(`/matches/${matchId}/record`, {
    headers: authHeaders(apiKey),
  });
  return { status, body };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const TERMINAL_STATUSES = ["avciKazandi", "kacakKazandi"];

/**
 * Play a Fugitive (kacak) match to completion using the "keep moving"
 * strategy the README's baseline numbers endorse (58.7% loss rate when
 * staying put vs ~6.3% loss rate when wandering).
 */
async function playKacakMatch(apiKey, turnCap = 40) {
  const created = await createMatch(apiKey, "kacak", []);
  const matchId = created.matchId;
  let view = created.view;
  let status = created.status;
  let turns = 0;

  console.log(`\n--- Match ${matchId} (role=kacak) ---`);
  console.log(`Start: ${view.kendiKonum}, turSiniri=${view.turSiniri}`);

  while (!TERMINAL_STATUSES.includes(status) && turns < turnCap) {
    turns += 1;
    let moveBody;
    if (Array.isArray(view.komsular) && view.komsular.length > 0) {
      moveBody = { type: "git", to: pickRandom(view.komsular) };
    } else {
      // FRICTION: docs don't say what a Fugitive should do if komsular
      // is empty (dead-end page). Falling back to "kal" since it's the
      // only other always-legal move type documented.
      moveBody = { type: "kal" };
    }

    const result = await move(apiKey, matchId, moveBody);
    if (result.status !== 200) {
      console.log(
        `  turn ${turns}: move FAILED status=${result.status} body=${JSON.stringify(
          result.body
        )}`
      );
      break;
    }
    view = result.body.view;
    status = result.body.status;
    console.log(
      `  turn ${turns}: ${JSON.stringify(moveBody)} -> at ${view.kendiKonum}, durum=${view.durum}`
    );
  }

  console.log(`Match ${matchId} ended: status=${status}, turns played=${turns}`);
  return { matchId, finalStatus: status, turns };
}

/**
 * Play a Hunter (avci) match to completion.
 * Strategy (best-effort reasoning from docs alone): move toward unexplored
 * neighbors, periodically ask the system Referee a free-text question, and
 * attempt a capture once we've been at the same page long enough that it
 * seems plausible the Fugitive could be co-located. Since AvciView does not
 * document any distance/location signal usable without a specialization,
 * and no specializations were declared (avoids 403 on undeclared tools),
 * our capture timing is effectively a guess -- this is itself a friction
 * point (see report).
 */
async function playAvciMatch(apiKey, turnCap = 40) {
  const created = await createMatch(apiKey, "avci", []);
  const matchId = created.matchId;
  let view = created.view;
  let status = created.status;
  let turns = 0;

  console.log(`\n--- Match ${matchId} (role=avci) ---`);
  console.log(`Start: ${view.kendiKonum}, turSiniri=${view.turSiniri}`);

  const visited = new Set([view.kendiKonum]);

  while (!TERMINAL_STATUSES.includes(status) && turns < turnCap) {
    turns += 1;
    let moveBody;

    // Every 5th turn, ask the system referee a free-text question (no
    // documented fixed question vocabulary was given, so this is a
    // natural-language guess at best effort).
    if (turns % 5 === 0) {
      moveBody = {
        type: "sorHakeme",
        mesaj: "Kaçak şu anda hangi kategoriye ait bir sayfada?",
      };
    } else if (turns % 7 === 0) {
      // Occasionally attempt a capture as a hedge (cheap: wrong capture
      // only costs the turn per the exam answer we confirmed).
      moveBody = { type: "yakala" };
    } else if (Array.isArray(view.komsular) && view.komsular.length > 0) {
      const unvisited = view.komsular.filter((p) => !visited.has(p));
      const target =
        unvisited.length > 0 ? pickRandom(unvisited) : pickRandom(view.komsular);
      moveBody = { type: "git", to: target };
    } else {
      moveBody = { type: "yakala" };
    }

    const result = await move(apiKey, matchId, moveBody);
    if (result.status !== 200) {
      console.log(
        `  turn ${turns}: move FAILED status=${result.status} body=${JSON.stringify(
          result.body
        )}`
      );
      break;
    }
    view = result.body.view;
    status = result.body.status;
    visited.add(view.kendiKonum);
    const extra = result.body.toolSonucu
      ? ` toolSonucu=${JSON.stringify(result.body.toolSonucu)}`
      : "";
    console.log(
      `  turn ${turns}: ${JSON.stringify(moveBody)} -> at ${view.kendiKonum}, durum=${view.durum}${extra}`
    );
  }

  console.log(`Match ${matchId} ended: status=${status}, turns played=${turns}`);
  return { matchId, finalStatus: status, turns };
}

async function main() {
  console.log("Registering bot...");
  const { botId, apiKey } = await registerBot("taze-goz-g4c1");
  console.log(`botId=${botId}`);
  console.log(`apiKey=${apiKey} (only shown once, per /bots 'not' field)`);

  console.log("\nFetching + answering entrance exam...");
  const examResult = await takeExam(apiKey);
  console.log("Exam result:", JSON.stringify(examResult));
  if (examResult.gecti !== true) {
    throw new Error("Exam not passed, cannot proceed to /matches.");
  }

  const summaries = [];

  // Match 1: Fugitive
  summaries.push({ role: "kacak", ...(await playKacakMatch(apiKey)) });

  // Match 2: Fugitive again (consistent, easiest-to-reason-about role)
  summaries.push({ role: "kacak", ...(await playKacakMatch(apiKey)) });

  // Match 3: Hunter, to also exercise that branch of the protocol
  summaries.push({ role: "avci", ...(await playAvciMatch(apiKey)) });

  console.log("\n=== Fetching match records ===");
  for (const s of summaries) {
    const { status, body } = await getRecord(apiKey, s.matchId);
    console.log(`\nRecord for ${s.matchId} (status=${status}):`);
    if (status === 200) {
      console.log(
        `  final status=${body.status}, seed=${body.seed}, turnLimit=${body.turnLimit}, turns-logged=${body.turns.length}`
      );
    } else {
      console.log(`  ${JSON.stringify(body)}`);
    }
  }

  console.log("\n=== Summary ===");
  for (const s of summaries) {
    console.log(
      `${s.matchId}: role=${s.role} finalStatus=${s.finalStatus} turns=${s.turns}`
    );
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
