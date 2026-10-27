// Oefenplanner: kiest per kaart het leeritem, de oefenvorm en de richting.
// Houdt beheersing alleen in het geheugen bij, voor de lopende sessie.

import { norm } from './grader.js';

export const TYPES = {
  flash_fr:    { skill: 'lezen',     dir: 'fr2nl', stage: 0 },
  flash_nl:    { skill: 'lezen',     dir: 'nl2fr', stage: 0 },
  repeat:      { skill: 'spreken',   dir: 'fr',    stage: 1, needs: ['audio', 'mic'] },
  mc_fr2nl:    { skill: 'lezen',     dir: 'fr2nl', stage: 1 },
  mc_nl2fr:    { skill: 'lezen',     dir: 'nl2fr', stage: 1 },
  listen_mc:   { skill: 'luisteren', dir: 'fr2nl', stage: 1, needs: ['audio'] },
  type_fr2nl:  { skill: 'schrijven', dir: 'fr2nl', stage: 2 },
  type_nl2fr:  { skill: 'schrijven', dir: 'nl2fr', stage: 2 },
  listen_type: { skill: 'luisteren', dir: 'fr2nl', stage: 2, needs: ['audio'] },
  dictee:      { skill: 'luisteren', dir: 'fr',    stage: 2, needs: ['audio'] },
  fill:        { skill: 'schrijven', dir: 'nl2fr', stage: 2, needsFill: true },
  speak:       { skill: 'spreken',   dir: 'nl2fr', stage: 3, needs: ['mic'] },
};

const STAGE_TYPES = [
  ['flash_fr', 'flash_nl'],
  ['mc_fr2nl', 'mc_nl2fr', 'listen_mc', 'repeat'],
  ['type_fr2nl', 'type_nl2fr', 'listen_type', 'dictee', 'fill'],
  ['speak', 'type_nl2fr', 'fill', 'dictee', 'listen_type', 'type_fr2nl'],
];

const BLOCK_CARDS = 12;
const BLOCK_MAX = 18;
const POOL_SIZE = 6;
const MAX_RETRIES_PER_ITEM = 2;
// Maximaal aantal kaarten van een vorm per blok, zodat de vaardigheden afwisselen.
const BLOCK_TYPE_CAP = { repeat: 2, speak: 3, dictee: 2, listen_mc: 3, listen_type: 2 };

export class Planner {
  constructor(items, rnd = Math.random) {
    this.items = items;
    this.rnd = rnd;
    this.state = new Map(items.map((it) => [it.id, {
      level: 0, seen: 0, errors: 0, lastBlock: 0,
      dirs: { nl2fr: 0, fr2nl: 0, fr: 0 },
      types: {},
    }]));
    this.available = { audio: true, mic: true };
    this.blockNo = 0;
  }

  setAvailable(key, value) { this.available[key] = value; }

  startBlock() {
    this.blockNo++;
    this.block = {
      pool: this.choosePool(),
      shown: 0, cards: [], retries: [], typeCount: {}, perItem: new Map(), retryCount: new Map(),
      skills: { lezen: 0, schrijven: 0, luisteren: 0, spreken: 0 },
      repeatedSkills: { lezen: 0, schrijven: 0, luisteren: 0, spreken: 0 },
      skipped: new Set(), difficult: new Set(), lastId: null,
    };
    return this.block;
  }

  choosePool() {
    const st = (it) => this.state.get(it.id);
    const pool = [];
    const add = (it, max = POOL_SIZE) => { if (it && !pool.includes(it) && pool.length < max) pool.push(it); };
    const oldestFirst = (a, b) => st(a).lastBlock - st(b).lastBlock || st(a).level - st(b).level || this.rnd() - 0.5;
    // 1. Woorden met fouten die nog niet beheerst zijn.
    this.items.filter((it) => st(it).seen > 0 && st(it).errors > 0 && st(it).level < 3)
      .sort((a, b) => st(b).errors - st(a).errors || oldestFirst(a, b)).forEach((it) => add(it, 2));
    // 2. Woorden die onderweg zijn: verder opbouwen naar typen en spreken.
    const inProgress = this.items.filter((it) => st(it).seen > 0 && st(it).level < 4).sort(oldestFirst);
    inProgress.forEach((it) => add(it, 4));
    // 3. Nieuwe stof in bronvolgorde, verspreid over de apprendres.
    interleaveBySource(this.items.filter((it) => st(it).seen === 0)).forEach((it) => add(it));
    // 4. Aanvullen met wat onderweg is, daarna onderhoud van beheerste woorden.
    inProgress.forEach((it) => add(it));
    [...this.items].sort(oldestFirst).forEach((it) => add(it));
    return pool;
  }

  /** Volgende kaart, of null als het blok klaar is. */
  next() {
    const b = this.block;
    if (b.shown >= BLOCK_MAX) return null;
    // Eerst herhalingen die aan de beurt zijn.
    const dueIdx = b.retries.findIndex((r) => r.due <= b.shown && r.itemId !== b.lastId);
    let it;
    if (dueIdx >= 0) {
      it = this.items.find((x) => x.id === b.retries[dueIdx].itemId);
      b.retries.splice(dueIdx, 1);
    } else if (b.shown >= BLOCK_CARDS) {
      if (!b.retries.length) return null;
      // Blok is vol: alleen nog openstaande herhalingen afmaken.
      const r = b.retries.shift();
      it = this.items.find((x) => x.id === r.itemId);
    } else {
      const candidates = b.pool.filter((x) => x.id !== b.lastId || b.pool.length === 1);
      candidates.sort((x, y) => (b.perItem.get(x.id) || 0) - (b.perItem.get(y.id) || 0)
        || this.state.get(x.id).level - this.state.get(y.id).level || this.rnd() - 0.5);
      it = candidates[0];
    }
    if (!it) return null;
    const type = this.chooseType(it);
    b.shown++;
    b.lastId = it.id;
    b.perItem.set(it.id, (b.perItem.get(it.id) || 0) + 1);
    const card = { item: it, type, index: b.shown, isRetry: dueIdx >= 0 };
    b.cards.push(card);
    return card;
  }

  chooseType(it) {
    const st = this.state.get(it.id);
    const b = this.block;
    const ok = (t) => {
      const def = TYPES[t];
      if (def.needs && def.needs.some((n) => !this.available[n])) return false;
      if (def.needsFill && !it.fill) return false;
      if (t.startsWith('mc') && this.items.length < 3) return false;
      if (t === 'dictee' && it.tts.length > 30) return false;
      if ((b.typeCount[t] || 0) >= (BLOCK_TYPE_CAP[t] ?? 99)) return false;
      if (t === 'repeat' && st.types.repeat) return false; // nazeggen één keer per woord is genoeg
      return true;
    };
    let stage = Math.min(st.level, 3);
    // Eén omdraaikaart om kennis te maken; daarna naar herkennen, ook als het nog niet zeker zat.
    if (stage === 0 && st.seen > 0) stage = 1;
    let options = [];
    while (stage >= 0 && !options.length) {
      options = STAGE_TYPES[stage].filter(ok);
      stage--;
    }
    if (!options.length) options = ['flash_fr'];
    // Score: weinig geoefende richting en vaardigheid eerst, en niet steeds dezelfde vorm.
    const score = (t) => {
      const def = TYPES[t];
      const fillBonus = t === 'fill' && !st.types.fill ? -1.5 : 0;
      return (st.dirs[def.dir] || 0) * 2 + (b.typeCount[t] || 0) * 0.8 + (b.skills[def.skill] || 0) * 0.4
        + (st.types[t] || 0) * 1.5 + fillBonus + this.rnd();
    };
    options.sort((x, y) => score(x) - score(y));
    b.typeCount[options[0]] = (b.typeCount[options[0]] || 0) + 1;
    return options[0];
  }

  /**
   * Verwerkt een uitkomst: 'goed', 'bijna', 'fout' of 'overgeslagen'.
   */
  record(card, outcome) {
    const st = this.state.get(card.item.id);
    const def = TYPES[card.type];
    const b = this.block;
    if (outcome === 'overgeslagen') {
      b.skipped.add(def.skill);
      return;
    }
    st.seen++;
    st.lastBlock = this.blockNo;
    st.dirs[def.dir] = (st.dirs[def.dir] || 0) + 1;
    st.types[card.type] = (st.types[card.type] || 0) + 1;
    b.skills[def.skill]++;
    if (card.isRetry) b.repeatedSkills[def.skill]++;
    if (outcome === 'goed') {
      st.level = Math.min(4, st.level + 1);
    } else {
      st.errors++;
      b.difficult.add(card.item.id);
      if (outcome === 'fout') st.level = Math.max(0, st.level - 1);
      this.scheduleRetry(card.item.id);
    }
  }

  scheduleRetry(itemId) {
    const b = this.block;
    const n = b.retryCount.get(itemId) || 0;
    if (n >= MAX_RETRIES_PER_ITEM) return; // Eén lastig woord mag het blok niet overheersen.
    b.retryCount.set(itemId, n + 1);
    b.retries.push({ itemId, due: b.shown + 3 + Math.floor(this.rnd() * 3) });
  }

  progress() {
    const b = this.block;
    return { done: b.shown, total: Math.max(BLOCK_CARDS, Math.min(BLOCK_MAX, b.shown + b.retries.length)) };
  }

  summary() {
    const b = this.block;
    const difficult = [...b.difficult].map((id) => this.items.find((x) => x.id === id));
    const practised = new Map();
    for (const c of b.cards) practised.set(c.item.id, c.item);
    const repeated = Object.entries(b.repeatedSkills).sort((x, y) => y[1] - x[1]).filter(([, n]) => n > 0).map(([s]) => s);
    const dirsTotal = { nl2fr: 0, fr2nl: 0 };
    for (const c of b.cards) {
      const d = TYPES[c.type].dir;
      if (d in dirsTotal) dirsTotal[d]++;
    }
    return { skills: { ...b.skills }, difficult, practised: [...practised.values()], repeated, skipped: [...b.skipped], dirs: dirsTotal };
  }

  /** Afleiders voor meerkeuze, uit de actuele leerstof, zonder tweede goed antwoord. */
  distractors(it, lang, count = 3) {
    const own = new Set((lang === 'fr' ? it.accept.fr : it.accept.nl).map(norm));
    const ownOther = new Set((lang === 'fr' ? it.accept.nl : it.accept.fr).map(norm));
    const pool = this.items.filter((o) => {
      if (o.id === it.id) return false;
      const theirs = (lang === 'fr' ? o.accept.fr : o.accept.nl).map(norm);
      if (theirs.some((x) => own.has(x))) return false;
      // Geen opties met (deels) dezelfde betekenis: die zouden ook goed kunnen zijn.
      const theirOther = (lang === 'fr' ? o.accept.nl : o.accept.fr).map(norm);
      if (theirOther.some((x) => ownOther.has(x))) return false;
      return true;
    });
    const sameKind = pool.filter((o) => o.kind === it.kind);
    const rest = pool.filter((o) => o.kind !== it.kind);
    shuffle(sameKind, this.rnd);
    shuffle(rest, this.rnd);
    return [...sameKind, ...rest].slice(0, count);
  }
}

function interleaveBySource(list) {
  const groups = new Map();
  for (const it of list) {
    const k = it.sources[0].apprendre;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const out = [];
  const queues = [...groups.values()];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift());
  return out;
}

export function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
