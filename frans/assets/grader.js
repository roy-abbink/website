// Deterministisch nakijken van getypte en gesproken antwoorden.
// Uitkomsten: 'goed', 'bijna' (kleine schrijfafwijking) en 'fout' (inhoudelijke of grammaticale fout).

const APOS = /[’‘`´ʼ′]/g;
const SPACES = /[    \s]+/g;

/** Normaliseert zonder accenten te wissen: hoofdletters, spaties, apostrofs en leestekens aan de randen. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(APOS, "'")
    .replace(/[«»“”"]/g, '')
    .replace(SPACES, ' ')
    .replace(/\s*'\s*/g, "'")
    .replace(/\s+([?!:;.,…])/g, '$1')
    .replace(/[?!.;:…]+/g, ' ')
    .replace(/\s*,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

const noApos = (s) => s.replace(/['\s-]/g, '');

/** Damerau-Levenshtein (optimal string alignment). */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const ARTICLE = /^(le |la |les |l')(.+)$/;

/** Beschrijft accentverschillen letter voor letter, bijvoorbeeld “ç in plaats van c”. */
function accentNotes(given, target) {
  const g = [...given];
  const t = [...target];
  const notes = [];
  if (g.length === t.length) {
    for (let i = 0; i < t.length; i++) {
      if (g[i] !== t[i]) {
        notes.push(stripAccents(t[i]) === t[i] ? `hier hoort geen accent: ${t[i]} in plaats van ${g[i]}` : `${t[i]} in plaats van ${g[i]}`);
      }
    }
  }
  return notes;
}

/**
 * Kijkt een getypt antwoord na.
 * @param {string} input   wat de leerling typte
 * @param {object} opts    { accepted: string[], lang: 'fr'|'nl', item, others: item[] }
 */
export function grade(input, { accepted, lang, item, others = [] }) {
  const u = norm(input);
  const targets = accepted.map(norm);
  const model = accepted[0];
  if (!u) return { result: 'leeg' };

  if (targets.includes(u)) return { result: 'goed', model: matchModel(u, accepted) };

  if (lang === 'nl') return gradeDutch(u, accepted, targets, others);

  // Frans: let op schrijfwijze, lidwoorden en vervoegingen.
  for (let k = 0; k < targets.length; k++) {
    const a = targets[k];
    const shown = accepted[k];
    if (stripAccents(u) === stripAccents(a)) {
      const notes = accentNotes(u, a);
      return {
        result: 'bijna', model: shown, kind: 'accent',
        message: notes.length ? `Let op het accent: ${notes.join(', ')}.` : 'Let op de accenten.',
      };
    }
    if (noApos(stripAccents(u)) === noApos(stripAccents(a)) && a.includes("'")) {
      const alsoAccent = noApos(u) !== noApos(a);
      return {
        result: 'bijna', model: shown, kind: 'apostrof',
        message: `Vergeet de apostrof niet: ${shown}.` + (alsoAccent ? ' Let ook op de accenten.' : ''),
      };
    }
  }

  // Lidwoordfouten: ander of ontbrekend lidwoord.
  const am = targets[0].match(ARTICLE);
  if (am) {
    const um = u.match(ARTICLE);
    const rest = stripAccents(am[2]);
    if (um && stripAccents(um[2]) === rest && um[1] !== am[1]) {
      return { result: 'fout', model, kind: 'lidwoord', message: articleHint(item, am[1].trim()) };
    }
    if (!um && stripAccents(u) === rest) {
      return { result: 'fout', model, kind: 'lidwoord', message: `Je mist het lidwoord. ${articleHint(item, am[1].trim())}` };
    }
  }

  // Vervoegingen: voornaamwoord en werkwoordsvorm apart bekijken.
  if (item && item.kind === 'vervoeging') {
    const tw = targets[0].replace("'", "' ").split(' ').filter(Boolean);
    const uw = u.replace("'", "' ").split(' ').filter(Boolean);
    if (tw.length === 2 && uw.length === 2) {
      if (stripAccents(uw[0]) === stripAccents(tw[0]) && uw[1] !== tw[1]) {
        return { result: 'fout', model, kind: 'vervoeging', message: `Het voornaamwoord klopt, maar de vorm van het werkwoord niet. Bij “${tw[0].replace("' ", "'")}” hoort een andere vorm.` };
      }
      if (stripAccents(uw[1]) === stripAccents(tw[1]) && uw[0] !== tw[0]) {
        return { result: 'fout', model, kind: 'voornaamwoord', message: 'De werkwoordsvorm klopt, maar het persoonlijk voornaamwoord niet. Kijk nog eens naar wie het is.' };
      }
    }
  }

  // Een ander bekend woord uit de leerstof.
  const other = findOther(u, others, item, 'fr');
  if (other) {
    return { result: 'fout', model, kind: 'ander-woord', message: `“${other.fr}” betekent “${other.nl}”. Er wordt iets anders gevraagd.` };
  }

  // Kleine typefout, alleen bij langere woorden en nooit bij vervoegingen of lidwoorden.
  if (!(item && (item.kind === 'vervoeging'))) {
    for (let k = 0; k < targets.length; k++) {
      const a = stripAccents(targets[k]);
      const s = stripAccents(u);
      if (a.replace(/\s/g, '').length >= 5 && distance(s, a) === 1 && sameArticle(s, a)) {
        return { result: 'bijna', model: accepted[k], kind: 'typefout', message: `Kleine typefout. Zo schrijf je het: ${accepted[k]}.` };
      }
    }
  }

  return { result: 'fout', model, kind: 'anders', message: '' };
}

function sameArticle(a, b) {
  const ma = a.match(ARTICLE);
  const mb = b.match(ARTICLE);
  return (ma ? ma[1] : '') === (mb ? mb[1] : '');
}

function articleHint(item, art) {
  const word = item ? item.fr : '';
  if (art === "l'") return `Voor een klinker wordt het lidwoord l’: ${word}.`;
  if (art === 'le') return `Dit woord is mannelijk, dus le: ${word}.`;
  if (art === 'la') return `Dit woord is vrouwelijk, dus la: ${word}.`;
  return `Het goede lidwoord is ${art}: ${word}.`;
}

function matchModel(u, accepted) {
  return accepted.find((a) => norm(a) === u) || accepted[0];
}

const NL_ARTICLE = /^(de |het |een )/;

function gradeDutch(u, accepted, targets, others) {
  const strip = (s) => s.replace(NL_ARTICLE, '');
  const su = strip(u);
  for (let k = 0; k < targets.length; k++) {
    if (strip(targets[k]) === su) return { result: 'goed', model: accepted[k] };
  }
  // Meerdere betekenissen tegelijk, zoals “mooi, leuk” of “er is / er zijn”.
  const parts = u.split(/\s*(?:,|\/|\bof\b|\ben\b(?= ))\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => targets.some((t) => strip(t) === strip(p)))) {
    return { result: 'goed', model: accepted[0] };
  }
  // Spelling van het Nederlands is hier geen leerdoel: kleine typefout telt als goed, met een opmerking.
  for (let k = 0; k < targets.length; k++) {
    const t = strip(targets[k]);
    if (t.length >= 5 && distance(su, t) === 1) {
      return { result: 'goed', model: accepted[k], message: `Let op de spelling: ${accepted[k]}.` };
    }
  }
  const other = findOther(u, others, null, 'nl');
  if (other) {
    return { result: 'fout', model: accepted[0], kind: 'ander-woord', message: `“${other.nl}” is in het Frans “${other.fr}”. Er wordt iets anders gevraagd.` };
  }
  return { result: 'fout', model: accepted[0], kind: 'anders', message: '' };
}

function findOther(u, others, self, lang) {
  const strip = (s) => (lang === 'nl' ? s.replace(NL_ARTICLE, '') : s);
  for (const o of others) {
    if (self && o.id === self.id) continue;
    const list = lang === 'fr' ? o.accept.fr : o.accept.nl;
    if (list.some((x) => strip(norm(x)) === strip(u))) return o;
  }
  return null;
}

/** Korte hint na een eerste foute poging. */
export function hintFor(answer) {
  const words = answer.replace(/\s*\?$/, '').split(' ');
  const first = [...answer][0];
  const letters = answer.replace(/[^\p{L}]/gu, '').length;
  return words.length > 1
    ? `Hint: het zijn ${words.length} woorden en het begint met “${first}”.`
    : `Hint: het begint met “${first}” en heeft ${letters} letters.`;
}

/** Tokens voor spraakvergelijking: geen accenten, apostrofs en leestekens. */
function speechTokens(s) {
  return stripAccents(norm(s)).replace(/'/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Vergelijkt herkende spraak met de toegestane antwoorden.
 * Spraakherkenning schrijft zelf de spelling, dus accenten tellen hier niet mee.
 * Uitkomsten: 'goed', 'gedeeltelijk', 'anders', 'onzeker'.
 */
export function gradeSpeech(transcript, accepted, reliable) {
  const said = speechTokens(transcript || '');
  if (!reliable || said.length === 0) return { result: 'onzeker' };
  let bestPartial = 0;
  for (const acc of accepted) {
    const t = speechTokens(acc);
    if (!t.length) continue;
    // Alle doelwoorden in de juiste volgorde aanwezig (extra woorden zoals “euh” mogen).
    let i = 0;
    for (const w of said) if (i < t.length && closeWord(w, t[i])) i++;
    if (i === t.length) return { result: 'goed' };
    const hits = t.filter((w) => said.some((s) => closeWord(s, w))).length;
    bestPartial = Math.max(bestPartial, hits / t.length);
  }
  if (bestPartial >= 0.5) return { result: 'gedeeltelijk' };
  return { result: 'anders' };
}

function closeWord(a, b) {
  if (a === b) return true;
  // Kleine herkenningsverschillen bij langere woorden (bijv. “appel” vs “appelle”) niet als fout rekenen.
  return b.length >= 6 && distance(a, b) <= 1;
}
