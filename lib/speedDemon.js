const SHADOW_DOCS_KEY = 'cove_speed_demon_shadow_docs_v1';
const LIBRARY_CACHE_KEY = 'cove_speed_demon_library_v1';
const MAX_SHADOW_DOCS = 8000;
const MAX_CACHE_ENTRIES = 220;
const EMBED_DIM = 128;
const CACHE_HARD_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const CACHE_TTL_HIGH_MS = 1000 * 60 * 60 * 24;
const CACHE_TTL_MED_MS = 1000 * 60 * 60 * 6;
const CACHE_TTL_LOW_MS = 1000 * 60 * 45;
const RECENCY_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 3; // 3 days
const CORRECTION_TOKENS = ['actually', 'correction', 'update', 'sorry', 'i mean', 'not'];
const CONFLICT_SENSITIVE_TERMS = new Set([
  'latest', 'recent', 'current', 'now', 'today', 'actually', 'correct', 'color', 'favourite', 'favorite', 'changed my mind'
]);
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for',
  'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on',
  'or', 'our', 'so', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'who', 'why', 'with', 'would', 'you', 'your'
]);

// ─── Embedding Cache ─────────────────────────────────────────────────────────
const _embedCache = new Map();

function safeRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { }
}

function normalize(text = '') {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(text = '') {
  return normalize(text).split(/[^a-z0-9_]+/).filter(Boolean);
}

function meaningfulTokens(tokens = []) {
  return (Array.isArray(tokens) ? tokens : []).filter((t) => t && t.length >= 3 && !STOPWORDS.has(t));
}

function stemToken(token = '') {
  const t = String(token || '').toLowerCase().trim();
  if (!t) return '';
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ers')) return t.slice(0, -1);
  if (t.length > 4 && t.endsWith('er')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

function unique(arr = []) {
  return Array.from(new Set(Array.isArray(arr) ? arr : []));
}

function tokenHash(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function embedText(text = '') {
  const vec = new Array(EMBED_DIM).fill(0);
  const tokens = tokenize(text);
  if (!tokens.length) return vec;

  // Unigram hashing
  for (const token of tokens) {
    const h = tokenHash(token);
    const idx = h % EMBED_DIM;
    const sign = (h & 1) ? 1 : -1;
    vec[idx] += sign;
  }

  // Bigram hashing — captures word-pair context
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = tokens[i] + '_' + tokens[i + 1];
    const h = tokenHash(bigram);
    const idx = h % EMBED_DIM;
    const sign = (h & 1) ? 1 : -1;
    vec[idx] += sign * 0.5;
  }

  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/** Get or compute cached embedding for a document */
function getDocEmbed(doc) {
  if (_embedCache.has(doc.id)) return _embedCache.get(doc.id);
  const vec = embedText(doc.text);
  _embedCache.set(doc.id, vec);
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < EMBED_DIM; i++) dot += (a[i] || 0) * (b[i] || 0);
  return dot;
}

function keywordScore(queryTokens, text = '') {
  if (!queryTokens.length) return { score: 0, hits: 0 };
  const docTokens = new Set(tokenize(text).map(stemToken).filter(Boolean));
  let hits = 0;
  for (const token of queryTokens) {
    const st = stemToken(token);
    if (st && docTokens.has(st)) hits++;
  }
  return { score: hits / queryTokens.length, hits };
}

function conceptScore(queryTokens = [], text = '') {
  const qTokens = unique((Array.isArray(queryTokens) ? queryTokens : []).map(stemToken).filter((t) => t.length >= 3));
  if (!qTokens.length) return 0;
  const dTokens = unique(tokenize(text).map(stemToken).filter((t) => t.length >= 3));
  if (!dTokens.length) return 0;

  let matches = 0;
  for (const qt of qTokens) {
    let found = false;
    for (const dt of dTokens) {
      if (dt === qt) { found = true; break; }
      if (dt.includes(qt) || qt.includes(dt)) { found = true; break; }
      const minLen = Math.min(dt.length, qt.length);
      if (minLen >= 4) {
        const prefix = Math.min(5, minLen);
        if (dt.slice(0, prefix) === qt.slice(0, prefix)) { found = true; break; }
      }
    }
    if (found) matches++;
  }
  return matches / qTokens.length;
}

function phraseScore(queryTokens = [], text = '') {
  const tokens = Array.isArray(queryTokens) ? queryTokens.filter(Boolean) : [];
  if (tokens.length < 2) return 0;
  const low = normalize(text);
  if (!low) return 0;
  let hits = 0;
  let total = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    const phrase = `${tokens[i]} ${tokens[i + 1]}`;
    if (!phrase.trim()) continue;
    total++;
    if (low.includes(phrase)) hits++;
  }
  if (!total) return 0;
  return hits / total;
}

function correctionSignal(text = '') {
  const low = normalize(text);
  if (!low) return 0;
  const hasCorrection = CORRECTION_TOKENS.some((token) => low.includes(token));
  if (!hasCorrection) return 0;
  return 0.6; // Heavy signal
}

function isConflictSensitiveQuery(tokens = []) {
  return (Array.isArray(tokens) ? tokens : []).some((token) => CONFLICT_SENSITIVE_TERMS.has(token));
}

function dedupeRankedResults(ranked = [], limit = 8) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(ranked) ? ranked : []) {
    const key = normalize(item?.snippet || item?.text || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function makeSnippet(text = '', query = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= 220) return clean;
  const nq = normalize(query);
  const pos = nq ? normalize(clean).indexOf(nq) : -1;
  if (pos < 0) return `${clean.slice(0, 220).trimEnd()}...`;
  const start = Math.max(0, pos - 80);
  const end = Math.min(clean.length, start + 220);
  return `${start > 0 ? '...' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '...' : ''}`;
}

function readShadowDocs() {
  return safeRead(SHADOW_DOCS_KEY, []);
}

function writeShadowDocs(docs) {
  safeWrite(SHADOW_DOCS_KEY, docs.slice(0, MAX_SHADOW_DOCS));
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function computeAdaptiveTtlMs(qualityScore = 0, sourceCount = 0) {
  const q = clamp01(qualityScore);
  const s = Math.max(0, Number(sourceCount || 0));
  if (q >= 0.72 && s >= 3) return CACHE_TTL_HIGH_MS;
  if (q >= 0.45 && s >= 1) return CACHE_TTL_MED_MS;
  return CACHE_TTL_LOW_MS;
}

function normalizeCacheEntry(entry = {}) {
  const qualityScore = clamp01(entry.qualityScore || 0);
  const sourceCount = Number(entry.sourceCount || 0);
  const ttlMs = Number(entry.ttlMs || 0) || computeAdaptiveTtlMs(qualityScore, sourceCount);
  return {
    ...entry,
    qualityScore,
    sourceCount,
    ttlMs
  };
}

function pruneCache(entries = [], now = Date.now()) {
  const normalized = (Array.isArray(entries) ? entries : []).map(normalizeCacheEntry);
  return normalized.filter((e) => {
    const age = now - (e.ts || 0);
    if (age > CACHE_HARD_MAX_AGE_MS) return false;
    return age <= (e.ttlMs || CACHE_TTL_LOW_MS);
  }).slice(0, MAX_CACHE_ENTRIES);
}

/**
 * Local Fact Extraction — Heuristic parsing of
 * atomic facts to make them 'almost usable' index entries.
 */
const SUBJECT_MAP = {
  'vincentbranch23': 'Ren',
  'renbranch': 'Ren',
  'user': 'Ren' // fallback
};

export function extractFactsLocally(text = '', role = 'user', authorName = 'User') {
  // Backwards-compatible signature with optional opts as 4th param.
  // eslint-disable-next-line prefer-rest-params
  const opts = (arguments.length >= 4 && arguments[3] && typeof arguments[3] === 'object') ? arguments[3] : {};

  const clean = text.trim();
  if (clean.length < 5 || clean.length > 500) return [];
  const low = clean.toLowerCase();

  // Resolve identity: My -> [Name]'s (avoid double 's if already there)
  const baseName = (authorName && authorName !== 'User') ? authorName : 'User';
  const displayName = SUBJECT_MAP[baseName.toLowerCase()] || baseName;

  // Attempt to parse leading "[Name]:" prefix (as produced by buildDocsFromMessages)
  let speakerName = displayName;
  let body = clean;
  const prefix = clean.match(/^\[([^\]]{2,60})\]:\s*(.+)$/);
  if (prefix) {
    speakerName = String(prefix[1] || '').trim() || speakerName;
    body = String(prefix[2] || '').trim();
  }

  const mentionedTs = Number(opts.ts || opts.timestamp || Date.now());
  const mentionedOn = (() => {
    try {
      return new Date(mentionedTs).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return '';
    }
  })();

  let resolvedText = body;
  if (/\bmy\b/i.test(resolvedText)) {
    resolvedText = resolvedText.replace(/\bmy\b/gi, `${speakerName}'s`);
  } else if (/\bi\sam\b/i.test(resolvedText)) {
    resolvedText = resolvedText.replace(/\bi\sam\b/gi, `${speakerName} is`);
  }
  resolvedText = resolvedText
    .replace(/\bi\s+(like|love|have|work|live)\b/gi, `${speakerName} $1s`)
    .replace(/\bme\b/gi, speakerName);

  // Clean up double apostrophes (e.g. Ren's's)
  resolvedText = resolvedText.replace(/'s's/gi, "'s");

  // ─── Resolve Inline Annotations ───
  // Handle annotations from enrichMessageText: "she (Ren)", "it (ref: ...)"
  // This helps us extract facts from conversational context.
  resolvedText = resolvedText.replace(/\b(it|this|that)\s+\(ref:\s+(.*?)\)/gi, '$2');
  resolvedText = resolvedText.replace(/\b(she|her|he|him|they|them|you|your)\s+\((.*?)\)/gi, '$2');
  // Strip bracketed indexing hints so they don't get captured as values
  const patternText = resolvedText.replace(/\[Context:[^\]]+\]/gi, '').trim();

  // Improved patterns: restrict subject capture to avoid "sentence-as-subject"
  const patterns = [
    { regex: /([^.!?]{2,30}?)'s favorite color (?:is|was|says|says it is|said it was)(?:\s+actually)?\s+([^.!?]{1,50})(?:\.|$)/i, subject: 1, attr: 'color', priority: 1 },
    { regex: /([^.!?]{2,30}?) (?:likes|loves|prefers) ([^.!?]{1,50})(?:\.|$)/i, subject: 1, attr: 'preference', priority: 1 },
    { regex: /([^.!?]{2,30}?) lives in ([^.!?]{1,50})(?:\.|$)/i, subject: 1, attr: 'location', priority: 1 },
    { regex: /([^.!?]{2,30}?) works at ([^.!?]{1,50})(?:\.|$)/i, subject: 1, attr: 'work', priority: 1 },
    { regex: /([^.!?]{2,30}?) (?:is|was|says|says it is|said it was)(?:\s+actually)?\s+([^.!?]{1,50})(?:\.|$)/i, subject: 1, attr: 'status', priority: 0 }
  ];

  const facts = [];
  const isCorrection = low.includes('actually') || low.includes('changed my mind') || low.includes('correction');

  // Forbidden Subjects: Attributes that often get mistaken for subjects of status facts
  // WE ADD COLORS HERE to prevent "Ren is Green" -> "Green says..."
  const FORBIDDEN_SUBJECTS = /favorite color|location|status|preference|lives in|works at|is a|green|blue|red|yellow|black|white|orange|purple|brown|pink|grey|gray|\bsaid\b|\bsays\b|\btold\b|\basked\b/i;

  // To prevent "Ren's color is blue" AND "Ren's color's status is blue"
  let matchedSpecific = false;

  for (const p of patterns) {
    if (matchedSpecific && p.priority === 0) continue;

    const match = patternText.match(p.regex);
    if (match) {
      const subject = match[p.subject]?.trim();
      const value = match[2]?.trim();

      // Validation:
      // 1. Subject exists
      // 2. Not a forbidden attribute (e.g. "Ren's favorite color" shouldn't be a subject)
      if (subject && value && subject.length > 1 && !FORBIDDEN_SUBJECTS.test(subject)) {
        const rawSubject = subject.toLowerCase().replace(/['']s$/, '');
        const normalizedSubject = SUBJECT_MAP[rawSubject] || subject;
        const confidence = isCorrection ? 1.0 : 0.95;
        facts.push({
          text: `FACT: ${normalizedSubject}'s ${p.attr} is ${value}`,
          source: 'fact',
          subject: normalizedSubject.toLowerCase(),
          confidence,
          speaker: speakerName,
          mentionedOn,
          ts: mentionedTs
        });
        if (mentionedOn) {
          facts.push({
            text: `FACT: It was mentioned on ${mentionedOn} that ${speakerName} said ${normalizedSubject}'s ${p.attr} was ${value}`,
            source: 'fact',
            subject: normalizedSubject.toLowerCase(),
            confidence: Math.max(0.55, confidence - 0.12), // hearsay phrasing is slightly lower
            speaker: speakerName,
            mentionedOn,
            ts: mentionedTs
          });
        }
        if (p.priority > 0) matchedSpecific = true;
      }
    }
  }

  // Contextual favorite-color inference:
  // If the message is like "her favorite was black" but the doc has a context hint,
  // promote it into an explicit favorite color fact.
  const contextMatch = clean.match(/\[Context:\s*([^.\]]{2,40})'s favorite color discussion\]/i);
  const ctxSubject = contextMatch?.[1]?.trim();
  const favColorLoose = patternText.match(/\bfavo(?:u)?rite\b(?:\s+colou?r)?\s+(?:is|was)\s+([A-Za-z][A-Za-z0-9_-]{1,24})\b/i) ||
    patternText.match(/\bfavo(?:u)?rite\b\s+(?:was|is)\s+([A-Za-z][A-Za-z0-9_-]{1,24})\b/i);
  if (ctxSubject && favColorLoose && favColorLoose[1]) {
    const color = favColorLoose[1].trim();
    const normalizedSubject = SUBJECT_MAP[String(ctxSubject).toLowerCase()] || ctxSubject;
    const confidence = isCorrection ? 0.98 : 0.78;
    facts.push({
      text: `FACT: ${normalizedSubject}'s favorite color is ${color}`,
      source: 'fact',
      subject: String(normalizedSubject).toLowerCase(),
      confidence,
      speaker: speakerName,
      mentionedOn,
      ts: mentionedTs
    });
    if (mentionedOn) {
      facts.push({
        text: `FACT: It was mentioned on ${mentionedOn} that ${speakerName} said ${normalizedSubject}'s favorite color was ${color}`,
        source: 'fact',
        subject: String(normalizedSubject).toLowerCase(),
        confidence: Math.max(0.55, confidence - 0.08),
        speaker: speakerName,
        mentionedOn,
        ts: mentionedTs
      });
    }
  }

  // Assistant verified answers are high signal
  if (role === 'assistant' && (low.includes('actually') || low.includes('correct'))) {
    facts.push({
      text: `VERIFIED: ${clean}`,
      source: 'fact',
      confidence: 0.9
    });
  }

  return facts;
}

/** Source-type scoring boost for enriched document types */
function sourceTypeBoost(source = '') {
  if (source === 'fact') return 0.25; // Massive boost for distilled facts
  if (source === 'entity-profile') return 0.15;
  if (source === 'file-shadow-deep') return 0.08;
  return 0;
}

export function upsertShadowDocuments(nextDocs = []) {
  if (!Array.isArray(nextDocs) || nextDocs.length === 0) return 0;
  const docs = readShadowDocs();
  const byId = new Map(docs.map(d => [d.id, d]));
  let added = 0;

  for (const doc of nextDocs) {
    if (!doc?.id || !doc?.text) continue;
    const normalizedText = String(doc.text).trim();
    if (!normalizedText) continue;

    // Invalidate embedding cache for updated docs
    _embedCache.delete(doc.id);

    // ─── Fact Enrichment ───
    // If it's a message, spend time decomposing it into atomic facts
    if (doc.source === 'message') {
      const facts = extractFactsLocally(normalizedText, doc.role, doc.authorName || 'User', {
        ts: doc.ts || Date.now(),
        chatId: doc.chatId || null,
        docId: doc.id
      });
      for (const fact of facts) {
        const factId = `fact_${doc.id}_${tokenHash(fact.text)}`;
        if (!byId.has(factId)) {
          byId.set(factId, {
            id: factId,
            chatId: doc.chatId || null,
            ts: doc.ts || Date.now(),
            source: 'fact',
            text: fact.text,
            subject: fact.subject || null,
            confidence: Number(fact.confidence || 0) || null,
            speaker: fact.speaker || null,
            mentionedOn: fact.mentionedOn || null,
            sourceDocId: doc.id
          });
          added++;
        }
      }
    }

    byId.set(doc.id, {
      id: doc.id,
      chatId: doc.chatId || null,
      ts: doc.ts || Date.now(),
      source: doc.source || 'message',
      text: normalizedText,
      authorName: doc.authorName || null
    });
    added++;
  }

  const merged = Array.from(byId.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  writeShadowDocs(merged);
  return added;
}

export function hybridSearch(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const docs = readShadowDocs();
  if (!docs.length) return [];
  const { chatId = null, limit = 8 } = opts;
  const filtered = chatId ? docs.filter(d => d.chatId === chatId) : docs;
  const newestTs = filtered.reduce((max, d) => Math.max(max, Number(d?.ts || 0)), 0) || Date.now();
  const baseTokens = tokenize(q);
  const richTokens = meaningfulTokens(baseTokens);
  const qTokens = richTokens.length ? richTokens : baseTokens;
  const conflictSensitive = isConflictSensitiveQuery(qTokens);
  const qVec = embedText(q);

  const ranked = filtered.map((doc) => {
    const kInfo = keywordScore(qTokens, doc.text);
    const k = kInfo.score;
    const c = conceptScore(qTokens, doc.text);
    const p = phraseScore(qTokens, doc.text);
    const s = cosine(qVec, getDocEmbed(doc));
    const srcBoost = sourceTypeBoost(doc.source);

    // ─── Subject Match Boost ───
    // If the doc has a specific subject (e.g. 'ren') and the query mentions it
    let subjectBoost = 0;
    if (doc.subject) {
       const sub = String(doc.subject).toLowerCase();
       if (qTokens.some(t => t.toLowerCase() === sub)) {
          subjectBoost = 0.2; // Significant boost for the right person
       }
    }

    const baseScore = (0.35 * k) + (0.15 * Math.max(0, s)) + (0.15 * p) + (0.1 * c) + srcBoost + subjectBoost;
    const ageMs = Math.max(0, newestTs - Number(doc?.ts || 0));
    const recencyBoost = Math.exp(-ageMs / RECENCY_HALF_LIFE_MS);
    const correctionBoost = correctionSignal(doc.text);
    const recencyWeight = conflictSensitive ? 0.3 : 0.16;
    const correctionWeight = conflictSensitive ? 0.25 : 0.04;
    const relevanceWeight = Math.max(0, 1 - recencyWeight - correctionWeight);
    const score =
      (relevanceWeight * baseScore) +
      (recencyWeight * recencyBoost) +
      (correctionWeight * correctionBoost);
    return {
      ...doc,
      score,
      baseScore,
      recencyBoost,
      phraseScore: p,
      conceptScore: c,
      correctionBoost,
      snippet: makeSnippet(doc.text, q),
      keywordScore: k,
      keywordHits: kInfo.hits,
      semanticScore: s
    };
  }).filter((r) => {
    if (r.score < 0.14) return false;
    if (qTokens.length >= 2 && r.keywordHits === 0 && r.semanticScore < 0.42) return false;
    return true;
  });

  ranked.sort((a, b) => b.score - a.score || (b.ts || 0) - (a.ts || 0));
  return dedupeRankedResults(ranked, limit);
}

export function evaluateRetrievalQuality(query, results = []) {
  const q = String(query || '').trim();
  const qBase = tokenize(q);
  const qTokens = meaningfulTokens(qBase).length ? meaningfulTokens(qBase) : qBase;
  const qUnique = unique(qTokens);
  const top = (Array.isArray(results) ? results : []).slice(0, 5);
  if (!qUnique.length || !top.length) {
    return {
      answerable: false,
      qualityScore: 0,
      bestOverlapRatio: 0,
      bestHitCount: 0,
      totalQueryTerms: qUnique.length,
      sourceCount: top.length
    };
  }

  const overlapStats = top.map((r) => {
    const dTokens = new Set(tokenize(String(r?.text || r?.snippet || '')));
    const hitTerms = qUnique.filter((t) => dTokens.has(t));
    return {
      hitTerms,
      hitCount: hitTerms.length,
      overlapRatio: qUnique.length ? hitTerms.length / qUnique.length : 0,
      score: Number(r?.score || 0)
    };
  });

  overlapStats.sort((a, b) => (b.overlapRatio - a.overlapRatio) || (b.score - a.score));
  const best = overlapStats[0] || { hitCount: 0, overlapRatio: 0, score: 0 };
  const scoreAvg = top.length ? top.slice(0, 3).reduce((acc, r) => acc + Number(r.score || 0), 0) / Math.min(3, top.length) : 0;
  const rareTokens = qUnique.filter((t) => t.length >= 5);
  const hasRareCoverage = rareTokens.length === 0 || rareTokens.some((t) => (best.hitTerms || []).includes(t));
  const answerable =
    best.hitCount >= 1 &&
    best.overlapRatio >= 0.34 &&
    scoreAvg >= 0.16 &&
    hasRareCoverage;

  return {
    answerable,
    qualityScore: Math.max(0, Math.min(1, (0.6 * best.overlapRatio) + (0.4 * Math.max(0, scoreAvg)))),
    bestOverlapRatio: best.overlapRatio,
    bestHitCount: best.hitCount,
    totalQueryTerms: qUnique.length,
    sourceCount: top.length
  };
}

export function buildContextCocktail(results = []) {
  if (!results.length) return '';
  return results.map((r, idx) => {
    const label = `Source ${idx + 1}`;
    return `[${label}] ${r.snippet}`;
  }).join('\n');
}

export function getLibraryAnswer(query, ttlMs = 1000 * 60 * 60 * 6) {
  const q = normalize(query);
  if (!q) return null;
  const raw = safeRead(LIBRARY_CACHE_KEY, []);
  const entries = pruneCache(raw);
  if (entries.length !== (Array.isArray(raw) ? raw.length : 0)) {
    safeWrite(LIBRARY_CACHE_KEY, entries);
  }
  const hit = entries.find(e => e?.key === q);
  if (!hit) return null;
  const dynamicTtl = Number(hit.ttlMs || 0) || ttlMs;
  if ((Date.now() - (hit.ts || 0)) > dynamicTtl) return null;
  return hit;
}

export function saveLibraryAnswer(query, answer, metadata = {}) {
  const q = normalize(query);
  if (!q || !answer) return;
  const entries = pruneCache(safeRead(LIBRARY_CACHE_KEY, []));
  const normalizedMeta = normalizeCacheEntry(metadata);
  const next = entries.filter(e => e?.key !== q);
  next.unshift({
    key: q,
    answer,
    ts: Date.now(),
    ...normalizedMeta
  });
  safeWrite(LIBRARY_CACHE_KEY, pruneCache(next));
}

export function getSpeedDemonStats() {
  const docs = readShadowDocs();
  const rawCache = safeRead(LIBRARY_CACHE_KEY, []);
  const cache = pruneCache(rawCache);
  if (cache.length !== (Array.isArray(rawCache) ? rawCache.length : 0)) {
    safeWrite(LIBRARY_CACHE_KEY, cache);
  }
  const avgQuality = cache.length
    ? cache.reduce((acc, item) => acc + clamp01(item.qualityScore || 0), 0) / cache.length
    : 0;
  return {
    shadowDocCount: Array.isArray(docs) ? docs.length : 0,
    cacheEntryCount: Array.isArray(cache) ? cache.length : 0,
    avgCacheQuality: Math.round(avgQuality * 100)
  };
}

export function clearLibraryCache() {
  safeWrite(LIBRARY_CACHE_KEY, []);
  _embedCache.clear();
}

export function clearShadowIndex() {
  safeWrite(SHADOW_DOCS_KEY, []);
  _embedCache.clear();
}

/** Broad fallback: return recent entity-profile and fact docs for a chat (or all chats). */
export function getEntityAndFactDocs(opts = {}) {
  const { chatId = null, limit = 12 } = opts;
  const docs = readShadowDocs();
  const filtered = chatId ? docs.filter(d => d.chatId === chatId) : docs;
  const enriched = filtered.filter(d =>
    d.source === 'entity-profile' || d.source === 'fact'
  );
  // Sort by recency
  enriched.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return enriched.slice(0, limit).map(d => ({
    ...d,
    score: 0.20,
    snippet: makeSnippet(d.text, ''),
    keywordHits: 0,
    semanticScore: 0
  }));
}

export function getShadowDocIdsForChat(chatId) {
  const cid = String(chatId || '');
  if (!cid) return [];
  const docs = readShadowDocs();
  return docs.filter(d => String(d?.chatId || '') === cid).map(d => d.id);
}
