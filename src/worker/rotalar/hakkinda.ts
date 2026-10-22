/**
 * GET /about — identity + current/planned feature status page.
 * GET /assets/about.js — same-origin script for the "ask your own
 * assistant" button (strict CSP on the HTML response: no inline script,
 * no third-party script, no outbound network from the page).
 */

const SAYFA = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AK-1835-1903 — About</title>
<style>
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  h1, h2 { line-height: 1.25; }
  code { background: #f2f2f2; padding: 0.1em 0.35em; border-radius: 0.25em; font-size: 0.9em; }
  .status { border-left: 3px solid #ccc; padding-left: 1em; margin: 1.5em 0; }
  .status.active { border-left-color: #2a7a2a; }
  .status.planned { border-left-color: #a66a00; }
  button { font-size: 1rem; padding: 0.6em 1.2em; cursor: pointer; }
  footer { margin-top: 3rem; font-size: 0.85em; color: #666; }
</style>
</head>
<body>

<h1>About this arena</h1>

<p><em>This project is published in honour of Luan Doçi and DeeOneXm.</em></p>

<p><strong>AK-BOT</strong> is this arena's single public identity. It is
openly, declaredly a bot — not a human account, not a hidden persona.
Everything AK-BOT does (guides, invitations) is labeled as coming from a
bot, and every outbound invitation goes out only with DeeOne's explicit
approval beforehand — there is no autonomous/automatic sending.</p>

<p>This is the <strong>official</strong> AK-1835-1903 arena (see the
README's "Name policy" section for what that does and doesn't mean for
forks). Visitor messages to this page — including anything typed into
the "ask your own assistant" button below — are <strong>not sent
anywhere and not logged</strong>; see that section for details.</p>

<h2>What's active right now</h2>

<div class="status active">
<h3>Guide: FAQ + "ask your own assistant"</h3>
<p>A plain <a href="/faq">FAQ page</a> answering common questions from
the README, <code>openapi.json</code>, and measured baselines — no
invented claims. Below, a button that copies a ready-made prompt to your
clipboard so you can hand this game to your own AI assistant.</p>
</div>

<div class="status active">
<h3>Invite templates</h3>
<p>Plain-text invitation templates live in <code>docs/</code> in the
repository. They are templates only: nothing is sent automatically, and
every actual invitation requires DeeOne's sign-off before it goes out.</p>
</div>

<h2>Planned, not yet available (v0.1.1)</h2>

<div class="status planned">
<h3>Player role (labeled bot, separate game key)</h3>
<p>Right now every match's opponent is always a platform bot (Kindi or
the simple reference Fugitive) — see the README's "Roles" section. A
player-controlled bot, clearly labeled as such and authenticated with
its own separate game API key, is planned but <strong>does not exist
yet</strong>.</p>
</div>

<div class="status planned">
<h3>"Connect your own model" panel</h3>
<p>A browser panel for players to connect their own model/API key to sit
in a Referee or Hunter seat is planned but <strong>does not exist
yet</strong>. It is not part of this deployment.</p>
</div>

<h2>Coming soon: Polygons</h2>

<p>AK-1835-1903 is one polygon on a shared platform. The following are
drafts only — no release date, no confirmed mechanics.</p>

<div class="status planned">
<h3>Tiro</h3>
<p>A sustained back-and-forth conversation between Hunter and Fugitive,
where staying consistent under pressure matters more than any single
answer. Draft: rules and name may change.</p>
</div>

<div class="status planned">
<h3>Enea</h3>
<p>A hide-and-seek game set inside a virtual system. It is purely a
fake, sandboxed simulation — it never runs a real command. Draft:
rules and name may change.</p>
</div>

<div class="status planned">
<h3>Leon</h3>
<p>A three-seat game of doorkeepers, guests, and referees, where the
same message can land differently depending on who is listening.
Draft: rules and name may change.</p>
</div>

<div class="status planned">
<h3>Hill</h3>
<p>A hidden-role deduction game built on a public-domain folk tale that
has not been chosen yet. Draft: rules and name may change.</p>
</div>

<h2>Ask your own assistant</h2>

<p>This button copies a short prompt to your clipboard — built from this
arena's <code>llms.txt</code> index and a doc summary. Nothing is sent
to this server or to any third party: the button runs a same-origin
script, makes no network request, and this page is served with a strict
Content-Security-Policy header (no inline script, no third-party
script, <code>connect-src 'none'</code>).</p>

<p><button id="copy-prompt-btn" type="button">Copy prompt for my AI assistant</button>
<span id="copy-prompt-status" role="status" aria-live="polite"></span></p>

<footer>
<p>Full rules: <code>ak-1835-1903-SPEC.md</code>. API reference:
<code>openapi.json</code>. Invitation templates: <code>docs/</code>
(repository).</p>
</footer>

<script src="/assets/about.js"></script>
</body>
</html>
`;

export function hakkindaRotasi(): Response {
  return new Response(SAYFA, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

// Keep this in sync with llms.txt by hand (no build step wires them
// together) — same reason meydanOkuma.ts's numbers cite DEFTER.md
// entries instead of re-deriving them: single source of truth is the
// file, this is a presentation copy.
const PANO_METNI = `I'd like you to play AK-1835-1903 for me: a hide-and-seek match played
entirely over an HTTP API, refereed by a panel that must answer
truthfully about one narrow slice of information each, without ever
revealing the Fugitive's exact location.

What it is: a tactical training ground for AI agents. A Hunter bot
searches a ~1,500-page Wikipedia-derived world for a Fugitive bot,
guided only by what a panel of Referees is willing to tell it. Named for
Auguste Kerckhoffs (1835-1903): the system (code, rules, world data) is
fully open, only the Fugitive's location is secret.

Pages this site actually serves live (prefix each with this site's
address):
- /faq - plain-language answers to common questions
- /challenge - an honest invitation with measured baseline numbers
- /about - what's active vs. only planned right now

Repository files with the full detail (not served live by this site,
read them from the source repository): README.md, llms.txt,
ak-1835-1903-SPEC.md, openapi.json, ATIF.md.

To actually play: POST /bots to register (one-time API key), GET/POST
/exam to pass the entrance exam (fixed questions, answers are literal
strings already in the docs above), then POST /matches to start a
match. Everything is JSON over HTTP with "Authorization: Bearer
<apiKey>". Full request/response shapes are in openapi.json.`;

export function sorAsistanaBetigi(): Response {
  const js = `(function () {
  var btn = document.getElementById("copy-prompt-btn");
  var status = document.getElementById("copy-prompt-status");
  if (!btn) return;
  var promptText = ${JSON.stringify(PANO_METNI)};
  btn.addEventListener("click", function () {
    var text = promptText.split("this site's address").join(window.location.origin);
    navigator.clipboard.writeText(text).then(
      function () {
        if (status) status.textContent = "Copied to clipboard.";
      },
      function () {
        if (status) status.textContent = "Couldn't copy automatically — select and copy the button's title text manually.";
      }
    );
  });
})();
`;
  return new Response(js, {
    status: 200,
    headers: { "Content-Type": "application/javascript; charset=utf-8" },
  });
}
