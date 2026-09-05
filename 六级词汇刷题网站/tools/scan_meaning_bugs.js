// Refined data-quality scanner.
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const htmlPath = path.join(__dirname, '..', 'cet6_quiz.html');

const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script type="application\/json" id="data-all-words">([\s\S]*?)<\/script>/);
const coreEmbedded = JSON.parse(m[1]);

function loadGlobal(filePath, globalName) {
  const code = fs.readFileSync(filePath, 'utf8');
  const vm = require('vm');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window[globalName];
}
const fullWords = loadGlobal(path.join(dataDir, 'full-words.js'), '__FULL_WORDS_DATA__');
const coreWordsObj = loadGlobal(path.join(dataDir, 'core-words.js'), '__CORE_WORDS__');
const coreMapWords = Object.entries(coreWordsObj).map(([word, v]) => ({ source: 'core-words.js', word, meaning: v && v.m, pron: v && v.p }));

const emb = coreEmbedded.map(w => ({ source: 'core-embedded', word: w.word, meaning: w.meaning, pron: w.pronunciation }));
const fullA = (fullWords || []).map(w => ({ source: 'full-words.js', word: w.word, meaning: w.meaning, pron: w.pronunciation }));

// Words already patched by the runtime repairs map (so runtime is OK; raw data is the buggy copy we can leave or fix).
const repairsWords = ['bunch','family','fibre','nightmare','ought','sunshine','tempo','animal','intake','mineral','wall','disarm','sweet','way'];
const runtimeMeaningRepairs = {
  optimum: 'n. 最优值；最佳状态'
};

// pronunciation fragment detection (now handles (r) style)
const pronFragRe = /^[\u00c0-\u024f\u0250-\u02af\u02b0-\u02ffa-zA-ZəːˈˌʊɪɒæθðʃʒŋɡjŊĢçɐɛɜɔɯәɨɾɹʍxɣβφχʧʤ'’ˈ.ˌ/\:\-()\[\]–]+?\s*\/(?=[ ]|$|[a-z])/i;
function isOnlyPos(meaning) {
  return /^(?:n|v|adj|adv|prep|pron|conj|num|art|aux|vi|vt|det|comb|abbr)\.?$/i.test(meaning);
}
function hasChinese(s) { return /[\u4e00-\u9fff]/.test(s); }

// gather by word across sources to compare
const byWord = new Map();
function add(item) {
  const k = item.word.toLowerCase();
  if (!byWord.has(k)) byWord.set(k, []);
  byWord.get(k).push(item);
}
emb.forEach(add); fullA.forEach(add); coreMapWords.forEach(add);

const report = [];
for (const [word, items] of byWord) {
  // Pick the core-embedded meaning as representative (that's what the quiz options use for core pool)
  const rep = items.find(i => i.source === 'core-embedded') || items[0];
  if (!rep.meaning) continue;
  const meaning = String(rep.meaning).trim();
  const flags = [];
  if (isOnlyPos(meaning)) flags.push('EMPTY-POS');
  if (!hasChinese(meaning)) flags.push('NO-CHINESE');
  // combined pos like "v./n. xxx" is fine, but "adj. adj. xxx" (duplicate pos) is not
  const dupPos = meaning.match(/^([a-z]+)\.\s*\.?\s*([a-z]+)\./i);
  if (dupPos && dupPos[1].toLowerCase() === dupPos[2].toLowerCase()) flags.push('DUP-POS');
  // leading pronunciation fragment (contains a slash and IPA chars before the first Chinese char)
  const beforeCn = meaning.split(/[\u4e00-\u9fff]/)[0];
  if (beforeCn && /[\/ˈˌːəɪɒʊæθðʃʒŋɡ]/.test(beforeCn) && hasChinese(meaning)) flags.push('LEADING-PRON');
  // trailing dangling punctuation (comma/semicolon at very end) after chinese
  if (/[，,；;、\s，]+$/.test(meaning)) flags.push('TRAILING-PUNCT');

  if (flags.length > 0) {
    const cn = meaning.split(/[\u4e00-\u9fff]/).filter(Boolean);
    const allSources = items.map(i => i.source).join(',');
    report.push({ word, meaning, flags, allSources });
  }
}

console.log('Words with suspicious meanings (per word, representative = core-embedded):');
console.log('word\tflags\tsources\tmeaning');
for (const r of report) {
  console.log(`${r.word}\t${r.flags.join('+')}\t${r.allSources}\t${JSON.stringify(r.meaning)}`);
}

// Semantic collision scan used by the quiz option generator.  It intentionally
// reports legitimate synonyms too: they remain in the dictionary, while the
// runtime skips putting colliding meanings in the same English-to-Chinese item.
function chineseKey(meaning) {
  return String(meaning || '').replace(/[^\u3400-\u9fff]/g, '');
}
function closeMeaning(a, b) {
  const ka = chineseKey(a), kb = chineseKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const minLen = Math.min(ka.length, kb.length);
  if (minLen < 4) return false;
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = ka.length <= kb.length ? kb : ka;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.85) return true;
  const sa = new Set();
  const sb = new Set();
  for (let i = 0; i < ka.length - 1; i++) sa.add(ka.slice(i, i + 2));
  for (let i = 0; i < kb.length - 1; i++) sb.add(kb.slice(i, i + 2));
  let inter = 0;
  for (const gram of sa) if (sb.has(gram)) inter++;
  return sa.size + sb.size - inter > 0 && inter / (sa.size + sb.size - inter) >= 0.8;
}

const semanticByWord = new Map();
for (const item of emb.concat(fullA)) {
  const key = item.word.toLowerCase();
  if (!semanticByWord.has(key)) semanticByWord.set(key, { word: item.word, meaning: runtimeMeaningRepairs[key] || item.meaning });
}
const semanticWords = Array.from(semanticByWord.values()).filter(item => chineseKey(item.meaning).length > 0);
const exactMeaningGroups = new Map();
for (const item of semanticWords) {
  const key = chineseKey(item.meaning);
  if (!exactMeaningGroups.has(key)) exactMeaningGroups.set(key, []);
  exactMeaningGroups.get(key).push(item.word);
}
const exactCollisions = Array.from(exactMeaningGroups.values()).filter(group => group.length > 1);
console.log('\nExact/normalized Chinese meaning collisions (retained as dictionary entries):');
if (exactCollisions.length === 0) console.log('(none)');
for (const group of exactCollisions) console.log(group.join(' | '));

const nearCollisions = [];
for (let i = 0; i < semanticWords.length; i++) {
  const a = semanticWords[i];
  const ka = chineseKey(a.meaning);
  for (let j = i + 1; j < semanticWords.length; j++) {
    const b = semanticWords[j];
    const kb = chineseKey(b.meaning);
    if (ka === kb || Math.abs(ka.length - kb.length) > 3) continue;
    if (closeMeaning(a.meaning, b.meaning)) nearCollisions.push({ a: a.word, b: b.word, meaningA: ka, meaningB: kb });
    if (nearCollisions.length >= 200) break;
  }
  if (nearCollisions.length >= 200) break;
}
console.log('\nHigh-overlap Chinese meaning pairs (first 200):');
if (nearCollisions.length === 0) console.log('(none)');
for (const pair of nearCollisions) console.log(`${pair.a} | ${pair.b}\t${pair.meaningA} ~ ${pair.meaningB}`);
