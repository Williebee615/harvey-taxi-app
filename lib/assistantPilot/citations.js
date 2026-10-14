// Assistant pilot: checks a generated answer before it is accepted.
// - Citations must refer to a source actually provided for this turn.
// - An answer with no valid citation is accepted only as an explicit
//   "not covered" statement; otherwise it is replaced.
// - Links, emails and phone numbers must appear in the provided sources.
// - No claim that an action was taken.

const NOT_COVERED = /\b(approved (information|sources?)|sources? (provided )?(do(es)?n['’]t|do not|does not)|not covered|don['’]t have (approved )?information)\b/i;
const ACTION_CLAIM = /\b(I('ve| have)|we('ve| have))\s+(booked|scheduled|cancel+ed|refunded|approved|submitted|updated|changed|sent)\b/i;
const LINKISH = /(https?:\/\/[^\s)]+|[^\s@]+@[^\s@]+\.[a-z]{2,}|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/gi;

function checkAnswer(text, passages) {
  const answer = String(text || "");
  const cited = new Set();
  const invalid = [];
  for (const m of answer.matchAll(/\[S(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= passages.length) cited.add(n);
    else invalid.push(m[0]);
  }
  const sourceText = passages.map((p) => `${p.text} ${p.url}`).join(" ").toLowerCase();
  const strayLinks = (answer.match(LINKISH) || []).filter((l) => !sourceText.includes(l.toLowerCase().replace(/[.,]$/, "")));
  const notCovered = NOT_COVERED.test(answer);
  let problem = null;
  if (!answer.trim()) problem = "empty";
  else if (invalid.length) problem = "invalid_citation";
  else if (ACTION_CLAIM.test(answer)) problem = "action_claim";
  else if (strayLinks.length) problem = "unsourced_contact_or_link";
  else if (!cited.size && !notCovered) problem = "uncited";
  return {
    ok: !problem,
    problem,
    notCovered: notCovered && !cited.size,
    sources: [...cited].sort((a, b) => a - b).map((n) => sourceRef(passages[n - 1], n))
  };
}

function sourceRef(p, n) {
  return { ref: `S${n}`, title: p.title, section: p.heading, url: p.url, version: p.version, effective_date: p.effective_date };
}

module.exports = { checkAnswer, sourceRef, NOT_COVERED };
