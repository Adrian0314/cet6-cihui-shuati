import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineFor, loadPools, loadRevisions, planRevisions, riskReasons, validateRevisions } from '../scripts/mnemonic-maintenance.mjs';

const pools = await loadPools();
const manifest = await loadRevisions();

test('all reviewed mnemonic changes are applied in both dictionaries without changing other data', () => {
  validateRevisions(pools, manifest);
  assert.equal(manifest.revisions.length, 975);
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


test('audit catches disconnected shape templates, unsupported root labels and truncated prompts without rewriting candidates', () => {
  assert.ok(riskReasons('联想 与 case 形近，cash 是手中的现钱 → 现金').includes('形近后直接释义，需补充联系'));
  assert.ok(riskReasons('联想 基础蔬菜词，pea 即豌豆').includes('释义重复，需补充记忆线索'));
  assert.ok(riskReasons('联想 与 courage 同根 cour(心) → 法庭').includes('同源标签，需核查依据与词义联系'));
  assert.ok(riskReasons('构词 inspect(检查)+-or(表示').includes('括号或结尾残缺，需核查原文'));
  assert.ok(riskReasons('联想 na(那)+vi(六)+').includes('括号或结尾残缺，需核查原文'));
  assert.deepEqual(riskReasons('联想 与 bag(包) 形近 → 挂在包上的小牌 → 标签'), []);
  assert.deepEqual(riskReasons('对照 裁缝先买一匹 cloth，再剪裁缝成 clothes → 布；织物'), []);
  // A flag requests review; a real relation can be flagged without being declared false.
  assert.ok(riskReasons('联想 与 global 同源 → 地球；地球仪').includes('同源标签，需核查依据与词义联系'));
});
