/* distractors.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ DISTRACTOR GENERATION ============
// 从索引数组中随机取 k 个（洗牌）。
// 干扰项候选池若按词库顺序取，会永远选中 id 靠前的词（如 ambition 是词库第一个名词），
// 导致每道题都出现同一批干扰项。
function sampleRandomIds(arr, k) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, k);
}
function getDistractors(correctWord, mode, count) {
  count = count || 3;
  var cid = correctWord.id;
  var cw = correctWord.word.toLowerCase();
  var used = Object.create(null);
  used[cid] = true;
  var usedTexts = Object.create(null);
  usedTexts[cw] = true;
  var candidates = [];
  var activePool = getActivePool();

  // === PRIORITY 1: Manual confusable groups (highest priority) ===
  // Always scan ALL_WORDS for confusable groups
  var groupMembers = getConfusableGroupMembers(correctWord.word);
  if (groupMembers.length > 0) {
    activePool.forEach(function(w) {
      if (groupMembers.indexOf(w.word.toLowerCase()) !== -1 && !used[w.id] && !usedTexts[w.word.toLowerCase()]) {
        candidates.push({ word: w, priority: 100 });
        used[w.id] = true;
        usedTexts[w.word.toLowerCase()] = true;
      }
    });
  }

  // === PRIORITY 2: Levenshtein distance based ===
  var prefix1 = cw[0];
  var minLen = cw.length - 3, maxLen = cw.length + 3;
  activePool.forEach(function(w) {
    if (used[w.id]) return;
    var wl = w.word.toLowerCase();
    if (usedTexts[wl]) return;
    if (wl[0] !== prefix1) return;
    if (wl.length < minLen || wl.length > maxLen) return;
    var dist = levenshtein(cw, wl);
    if (dist <= 3) {
      candidates.push({ word: w, priority: 80 - dist * 10 });
      usedTexts[wl] = true;
    }
  });

  // === PRIORITY 3: Same prefix (first 3 chars) ===
  var pf3 = cw.substring(0, 3);
  var indexPool = isKnownPool(currentPool) ? currentPool : 'core';
  var prefixPool = (window._prefixIdxByPool[indexPool] || {})[pf3] || [];
  sampleRandomIds(prefixPool, Math.min(prefixPool.length, 40)).forEach(function(id) {
    if (used[id]) return;
    var w = getWord(id, indexPool);
    if (!w || usedTexts[w.word.toLowerCase()]) return;
    candidates.push({ word: w, priority: 60 });
    used[id] = true;
    usedTexts[w.word.toLowerCase()] = true;
  });

  // === PRIORITY 4: Same POS ===
  var pm = correctWord.meaning.match(/^([a-z]+)\./i);
  if (pm) {
    var pos = pm[1].toLowerCase();
    var posPool = (window._posIdxByPool[indexPool] || {})[pos] || [];
    sampleRandomIds(posPool, Math.min(posPool.length, 60)).forEach(function(id) {
      if (used[id]) return;
      var w = getWord(id, indexPool);
      if (!w || usedTexts[w.word.toLowerCase()]) return;
      candidates.push({ word: w, priority: 40 });
      used[id] = true;
      usedTexts[w.word.toLowerCase()] = true;
    });
  }

  // === PRIORITY 5: Similar Chinese characters ===
  var cch = getChinese(correctWord.meaning);
  activePool.forEach(function(w) {
    if (used[w.id]) return;
    if (candidates.length >= count * 10) return;
    var wl = w.word.toLowerCase();
    if (usedTexts[wl]) return;
    var wm = getChinese(w.meaning);
    for (var i = 0; i < Math.min(cch.length - 1, wm.length - 1); i++) {
      if (wm.indexOf(cch.substring(i, i+2)) !== -1) {
        candidates.push({ word: w, priority: 20 });
        used[w.id] = true;
        usedTexts[wl] = true;
        break;
      }
    }
  });

  // 先统一剔除超长/空释义候选；不同优先级路径都经过这里，避免后续兜底再次混入。
  candidates = candidates.filter(function(item) {
    return isUsableDistractor(item.word, correctWord, mode);
  });

  // 按优先级降序；同一优先级内随机，保证干扰项每次不同
  candidates.forEach(function(c) { c.rand = Math.random(); });
  candidates.sort(function(a, b) {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.rand - b.rand;
  });

  // Fill result, ensuring diversity
  var result = [];
  var usedFirstChar = Object.create(null);
  var avoidMeaningCollision = mode !== 'cn2en';
  var selectedForMeaning = [correctWord];
  function canUseCandidate(word) {
    if (!avoidMeaningCollision) return true;
    for (var mi = 0; mi < selectedForMeaning.length; mi++) {
      if (meaningsTooClose(word, selectedForMeaning[mi])) return false;
    }
    return true;
  }

  for (var i = 0; i < candidates.length && result.length < count; i++) {
    if (!canUseCandidate(candidates[i].word)) continue;
    var fc = candidates[i].word.word.toLowerCase()[0];
    if ((usedFirstChar[fc] || 0) < 2) {
      result.push(candidates[i].word);
      selectedForMeaning.push(candidates[i].word);
      usedFirstChar[fc] = (usedFirstChar[fc] || 0) + 1;
    }
  }

  if (result.length < count) {
    for (var j = 0; j < candidates.length && result.length < count; j++) {
      if (result.indexOf(candidates[j].word) === -1 && canUseCandidate(candidates[j].word)) {
        result.push(candidates[j].word);
        selectedForMeaning.push(candidates[j].word);
      }
    }
  }

  // Last resort: random fill from activePool
  if (result.length < count) {
    var shuffled = activePool.slice().sort(function() { return Math.random() - 0.5; });
    for (var k = 0; k < shuffled.length && result.length < count; k++) {
      if (isUsableDistractor(shuffled[k], correctWord, mode) && result.indexOf(shuffled[k]) === -1 && canUseCandidate(shuffled[k])) {
        result.push(shuffled[k]);
        selectedForMeaning.push(shuffled[k]);
      }
    }
  }

  // 当前筛选范围（单元等）内可用且释义独立的候选不足时，从当前词库
  // 全库补足，尽量避免落到下面允许重复释义的兜底、让同根词挤进同一题。
  if (result.length < count) {
    var bankPool = (currentPool === 'core') ? ALL_WORDS : (ensureFullWords(), (FULL_WORDS || []));
    var bankSample = sampleRandomIds(bankPool.map(function(w) { return w; }), Math.min(bankPool.length, 400));
    for (var e = 0; e < bankSample.length && result.length < count; e++) {
      var bw = bankSample[e];
      if (usedTexts[bw.word.toLowerCase()] || result.indexOf(bw) !== -1) continue;
      if (!isUsableDistractor(bw, correctWord, mode) || !canUseCandidate(bw)) continue;
      result.push(bw);
      selectedForMeaning.push(bw);
      usedTexts[bw.word.toLowerCase()] = true;
    }
  }

  // 极小自定义词池可能没有足够的独立释义，最后才允许重复释义兜底，  // 以保证选择题仍有 count 个选项；正常六级词库不会走到这里。
  if (result.length < count) {
    for (var f = 0; f < activePool.length && result.length < count; f++) {
      if (isUsableDistractor(activePool[f], correctWord, mode) && result.indexOf(activePool[f]) === -1) result.push(activePool[f]);
    }
  }

  return result.slice(0, count);
}

function getConfusableDisplay(word, mode) {
  var result = [];
  var cw = word.word.toLowerCase();
  var used = Object.create(null);
  used[word.word.toLowerCase()] = true;

  // Manual confusable groups first
  var groupMembers = getConfusableGroupMembers(word.word);
  groupMembers.forEach(function(member) {
    ALL_WORDS.forEach(function(w) {
      if (w.word.toLowerCase() === member && !used[w.word.toLowerCase()]) {
        result.push({ word: w.word, meaning: w.meaning });
        used[w.word.toLowerCase()] = true;
      }
    });
  });

  // Levenshtein-based similar words
  var candidates = [];
  ALL_WORDS.forEach(function(w) {
    if (used[w.word.toLowerCase()]) return;
    var wl = w.word.toLowerCase();
    if (Math.abs(cw.length - wl.length) > 3) return;
    var dist = levenshtein(cw, wl);
    if (dist <= 2 && dist > 0) {
      candidates.push({ word: w, dist: dist });
    }
  });
  candidates.sort(function(a, b) { return a.dist - b.dist; });
  for (var i = 0; i < candidates.length && result.length < 3; i++) {
    result.push({ word: candidates[i].word.word, meaning: candidates[i].word.meaning });
    used[candidates[i].word.word.toLowerCase()] = true;
  }

  return result.slice(0, 4);
}
