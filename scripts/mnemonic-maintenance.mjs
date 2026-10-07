import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function loadPools() {
  const html = await readFile(resolve(root, 'cet6_quiz.html'), 'utf8');
  const full = await readFile(resolve(root, 'full-words.js'), 'utf8');
  const match = html.match(/<script type="application\/json" id="data-all-words">([\s\S]*?)<\/script>/);
  assert.ok(match, 'outline dictionary must exist');
  const box = { window: {} };
  runInNewContext(full, box);
  return {
    all: { file: 'cet6_quiz.html', source: html, block: match[1], words: JSON.parse(match[1]) },
    full: { file: 'full-words.js', source: full, words: JSON.parse(JSON.stringify(box.window.__FULL_WORDS_DATA__)) }
  };
}
export async function loadRevisions() {
  return JSON.parse(await readFile(resolve(root, 'scripts/mnemonic-revisions.json'), 'utf8'));
}
export function baselineFor(pools, revisions) {
  const reviewed = new Set(revisions.map(item => item.word));
  return Object.fromEntries(Object.entries(pools).map(([pool, { words }]) => [pool, {
    count: words.length,
    nonMemoHash: hash(words.map(({ memo, ...other }) => other)),
    untouchedMemosHash: hash(words.filter(item => !reviewed.has(item.word)).map(({ id, word, memo }) => ({ id, word, memo })))
  }]));
}
export function validateRevisions(pools, manifest) {
  const seen = new Set();
  for (const revision of manifest.revisions) {
    assert.ok(!seen.has(revision.word), `duplicate revision: ${revision.word}`);
    seen.add(revision.word);
    assert.match(revision.memo, /^(构词|联想|谐音|对照|提示) /, revision.word);
    assert.ok(revision.memo.includes('→'), revision.word);
    assert.ok(revision.memo.length <= 100, `overlong mnemonic: ${revision.word}`);
    assert.ok(revision.reason, `missing review reason: ${revision.word}`);
    for (const [pool, { words }] of Object.entries(pools)) {
      const matches = words.filter(item => item.word === revision.word);
      assert.equal(matches.length, revision.before[pool]?.length || 0, `${pool}: occurrence drift for ${revision.word}`);
      assert.ok(matches.every(item => item.memo === revision.memo), `${pool}: unapplied revision for ${revision.word}`);
    }
  }
  assert.deepEqual(baselineFor(pools, manifest.revisions), manifest.baseline, 'only reviewed memo fields may change');
}
export function planRevisions(pools, manifest) {
  assert.deepEqual(baselineFor(pools, manifest.revisions), manifest.baseline, 'only reviewed memo fields may change');
  const byWord = new Map(manifest.revisions.map(item => [item.word, item]));
  assert.equal(byWord.size, manifest.revisions.length, 'duplicate revision words');
  for (const revision of manifest.revisions) {
    for (const [pool, { words }] of Object.entries(pools)) {
      assert.equal(words.filter(item => item.word === revision.word).length, revision.before[pool]?.length || 0,
        `${pool}: occurrence drift for ${revision.word}`);
    }
  }
  const patches = [];
  for (const [pool, { words, source, file, block }] of Object.entries(pools)) {
    const updated = words.map(item => {
      const revision = byWord.get(item.word);
      if (!revision) return item;
      assert.ok(revision.before[pool]?.includes(item.memo) || item.memo === revision.memo,
        `${pool}: unexpected existing mnemonic for ${item.word}; review before overwriting`);
      return { ...item, memo: revision.memo };
    });
    const oldText = block || JSON.stringify(words);
    const newText = (block ? block.replace(JSON.stringify(words), () => JSON.stringify(updated)) : JSON.stringify(updated));
    assert.ok(source.includes(oldText), `${file}: serialized dictionary block must match`);
    if (oldText !== newText) patches.push({ file, oldText, newText });
  }
  return patches;
}
// Heuristics select review candidates; they cannot certify mnemonic quality or etymology.
export function riskReasons(memo = '') {
  const reasons = [];
  if (/发音类似|音似|读音像/.test(memo) && memo.replace(/\s/g, '').length < 48) reasons.push('短谐音/联想，需核查联系');
  if (/发音类似[^→。]+[→。]/.test(memo)) reasons.push('音译后跳释义，需核查联系');
  if (/音译词|直接记住|直接记忆/.test(memo)) reasons.push('音译/直接记忆，需核查准确性');
  if (/indu\(|-egy\(|cru\(|tamin\(|auth\(|cas\(e\)|striken|-estic|pleaded.*pleading|anniversary.*不是.*anniversary/.test(memo)) reasons.push('可疑拆词或知识错误');
  if (memo.length > 75) reasons.push('长故事/多段混搭，需核查负担');
  return reasons;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pools = await loadPools();
  const manifest = await loadRevisions();
  if (process.argv.includes('--plan')) {
    console.log(JSON.stringify(planRevisions(pools, manifest)));
  } else if (process.argv.includes('--audit')) {
    const candidates = [];
    for (const [pool, { words }] of Object.entries(pools)) {
      for (const { id, word, memo } of words) {
        const reasons = riskReasons(memo);
        if (reasons.length) candidates.push({ pool, id, word, memo, reasons });
      }
    }
    console.log(JSON.stringify({ note: '候选项不等于错误；未命中也不保证正确，仍需人工审核。', candidates }, null, 2));
  } else {
    validateRevisions(pools, manifest);
    const occurrences = manifest.revisions.reduce((sum, item) => sum + Object.values(item.before).reduce((n, values) => n + values.length, 0), 0);
    console.log(`Validated ${manifest.revisions.length} reviewed words / ${occurrences} entries; other fields, ordering and unreviewed memos unchanged.`);
  }
}
