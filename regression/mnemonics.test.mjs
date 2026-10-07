import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineFor, loadPools, loadRevisions, planRevisions, riskReasons, validateRevisions } from '../scripts/mnemonic-maintenance.mjs';

const pools = await loadPools();
const manifest = await loadRevisions();

test('all reviewed mnemonic changes are applied in both dictionaries without changing other data', () => {
  validateRevisions(pools, manifest);
  assert.equal(manifest.revisions.length, 202);
  assert.equal(pools.all.words.length, 6363);
  assert.equal(pools.full.words.length, 3324);
  assert.deepEqual(baselineFor(pools, manifest.revisions), manifest.baseline);
});

test('cruise connects a real collocation to a concrete voyage scene in both pools', () => {
  const entries = Object.values(pools).flatMap(pool => pool.words.filter(item => item.word === 'cruise'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].memo, entries[1].memo);
  for (const { memo } of entries) {
    assert.match(memo, /cruise ship（邮轮）/);
    assert.match(memo, /甲板.*海岸.*游览.*→.*乘船游览.*航行/);
    assert.doesNotMatch(memo, /克鲁兹|画十字|cru\(/);
  }
});

test('known misleading linguistic and semantic claims do not recur in repaired entries', () => {
  const checks = {
    strategy: /-egy|strat\(/, industry: /indu\(|str\(建造/, author: /auth\(/,
    contaminate: /tamin\(/, casual: /cas\(e\)|卡苏/, casualty: /cas\(e\)/,
    strive: /striken|striv\(e\) 和 strive/, plead: /pleaded.*pleading|\+ -d/,
    anniversary: /anniversary.*不是.*anniversary/, olive: /大力水手|奥利弗/,
    orange: /音译词/, potato: /音译词/, journal: /窝心|版本/, virtual: /龌/,
    senior: /泥人|呆板/, mortal: /没头|致命的.*缺点/, cucumber: /音似苦瓜/,
    history: /构词 拆读/, propaganda: /pro-\(提前\)|pa\(联想/
  };
  for (const { words } of Object.values(pools)) {
    for (const item of words) if (checks[item.word]) assert.doesNotMatch(item.memo, checks[item.word], item.word);
  }
  const veto = pools.all.words.find(item => item.word === 'veto').memo;
  assert.match(veto, /不是未投票/);
  assert.doesNotMatch(veto, /未投票就是否决/);
});

test('revision planner is idempotent and refuses unreviewed replacements', () => {
  assert.equal(planRevisions(pools, manifest).length, 0);
  const modified = structuredClone(pools);
  modified.all.words.find(item => item.word === 'cruise').memo = 'a later unreviewed change';
  assert.throws(() => planRevisions(modified, manifest), /unexpected existing mnemonic for cruise/);
  const collateral = structuredClone(pools);
  collateral.all.words.find(item => item.word === 'cruise').meaning = 'unexpected meaning change';
  assert.throws(() => planRevisions(collateral, manifest), /only reviewed memo fields may change/);
});

test('heuristic audit selects candidates but preserves reviewed sensible mnemonics', () => {
  assert.ok(riskReasons('谐音 发音类似克鲁兹 → 悠闲巡游 → 乘船游览').length);
  assert.ok(riskReasons('构词 indu(在内) + str(建造) + -y → 工业').includes('可疑拆词或知识错误'));
  // A plausible sound-scene mnemonic can also be flagged: it must not be automatically rewritten.
  const soar = pools.all.words.find(item => item.word === 'soar').memo;
  assert.match(soar, /烟花.*飞上天/);
  assert.ok(riskReasons(soar).length);
  assert.equal(manifest.revisions.some(item => item.word === 'soar'), false);
});
