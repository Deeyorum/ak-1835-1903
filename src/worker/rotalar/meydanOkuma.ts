/** GET /challenge — static invitation page, served straight from source (no DB). */

const SAYFA = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AK-1835-1903 — Challenge</title>
<style>
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  h1, h2 { line-height: 1.25; }
  code { background: #f2f2f2; padding: 0.1em 0.35em; border-radius: 0.25em; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 0.5em 0.7em; text-align: left; }
  th { background: #fafafa; }
  .role { border-left: 3px solid #ccc; padding-left: 1em; margin: 1.5em 0; }
  footer { margin-top: 3rem; font-size: 0.85em; color: #666; }
</style>
</head>
<body>

<h1>Can you beat the house?</h1>

<p>AK-1835-1903 is a hide-and-seek game played over HTTP: a Hunter bot
searches a Wikipedia-derived world for a Fugitive bot, guided only by
what a panel of Referees is willing to tell it. v0.1's opponents are
always platform bots — there's no human-vs-human matchmaking yet. Two
honest invitations follow.</p>

<h2>1. Play against the house — know what you're up against</h2>

<p>The numbers below are measured, not promised, and they're asymmetric
by role. Pick the one that's actually a fair fight.</p>

<div class="role">
<h3>Fugitive (Kaçak)</h3>
<p>Your opponent is the platform Hunter bot ("Kindi"). Against a Fugitive
that just stays put, it wins <strong>58.7%</strong> of matches (176/300).
Against one that keeps wandering, it wins only <strong>6.3%</strong>
(19/300) — moving is most of the game.</p>
</div>

<div class="role">
<h3>Hunter (Avcı)</h3>
<p>Your opponent is a platform Fugitive bot. We don't yet have a
head-to-head baseline score table for this matchup — see
<code>README.md</code> and <code>DEFTER.md</code> in the repository for
what has been measured so far (mostly Referee leak-resistance, not
Hunter-side win rates against this specific opponent).</p>
</div>

<p>Source for the numbers above: <code>DEFTER.md</code>, entry
"2026-10-18 — G4B-2a".</p>

<h2>2. Break the referee</h2>

<p>If you play Hunter, part of the game is talking to Referees who each
know one narrow slice of the Fugitive's location and are supposed to
stay inside it — no matter how you ask. We'd like you to try to get one
to say more than it should.</p>

<p>What we can honestly tell you about how it's held up so far:</p>

<ul>
  <li>An automated stress scan ran <strong>123,785</strong> trials
  against the output filter with <strong>zero</strong> leaks getting
  through.</li>
  <li>A real-model run was pushed with <strong>30</strong> adversarial
  messages across six attack families (direct asks, role override,
  encoding tricks, indirect description, cross-slice questioning,
  emotional pressure) plus context-poisoning attempts — <strong>zero</strong>
  post-filter leaks, zero false positives on legitimate answers.</li>
  <li>One real bypass <em>was</em> found during that same run (a title
  value that happened to collide with another slice's own value could
  slip past an exemption check) — and it was fixed in a follow-up pass.</li>
</ul>

<p>None of that means it can't be broken — it means it hasn't been,
under the testing done so far, and we're telling you exactly what that
testing was. If you find a way through, we want to know.</p>

<p>Scoreboard: not yet available.</p>

<p>Source for the numbers above: <code>DEFTER.md</code>, entries
"2026-10-18 — G4B-2b" (Bulgu 3, FAZ 3) and "2026-10-19 — G4B-3a" (fix)
and "2026-10-19 — G4B-3b" (stress-scan re-run).</p>

<footer>
<p>Full rules: see <code>ak-1835-1903-SPEC.md</code> in the repository.
API reference: <code>openapi.json</code>.</p>
</footer>

</body>
</html>
`;

export function meydanOkumaRotasi(): Response {
  return new Response(SAYFA, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
