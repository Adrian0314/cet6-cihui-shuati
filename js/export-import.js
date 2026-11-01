/* export-import.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ EXPORT ============
function exportWrongWords() {
  var hist = state.wrongHistory;
  if (hist.length === 0) { alert('没有错题可导出！'); return; }

  var lines = ['英语六级词库刷题系统 - 错题导出', '导出时间：' + nowStr(), '', '--- 按模式分类 ---', ''];

  var cn2enList = hist.filter(function(h) { return h.mode === 'cn2en'; });
  var en2cnList = hist.filter(function(h) { return h.mode === 'en2cn'; });

  if (cn2enList.length > 0) {
    lines.push('【看中文选英文 错题】共 ' + cn2enList.length + ' 题');
    lines.push('');
    // Deduplicate
    var seen = {};
    cn2enList.forEach(function(h) {
      var hKey = recordPool(h) + ':' + h.wordId;
      if (seen[hKey]) return;
      seen[hKey] = true;
      var w = recordWord(h);
      if (w) lines.push(w.word + ' ' + w.pronunciation + ' — ' + w.meaning);
    });
    lines.push('');
  }

  if (en2cnList.length > 0) {
    lines.push('【看英文选中文 错题】共 ' + en2cnList.length + ' 题');
    lines.push('');
    var seen2 = {};
    en2cnList.forEach(function(h) {
      var hKey = recordPool(h) + ':' + h.wordId;
      if (seen2[hKey]) return;
      seen2[hKey] = true;
      var w = recordWord(h);
      if (w) lines.push(w.word + ' ' + w.pronunciation + ' — ' + w.meaning);
    });
    lines.push('');
  }

  lines.push('--- 详细错题记录 ---');
  lines.push('');
  hist.forEach(function(h, i) {
    var w = recordWord(h);
    lines.push('#' + (i+1) + ' [' + h.timestamp + '] ' + (h.mode === 'cn2en' ? 'CN→EN' : 'EN→CN'));
    lines.push('  题目：' + h.questionText);
    lines.push('  你选：' + h.userAnswer + ' | 正确：' + h.correctAnswer);
    if (w) lines.push('  单词：' + w.word + ' ' + w.pronunciation + ' — ' + w.meaning);
    lines.push('');
  });

  var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'CET6_错题_' + localDateKey(new Date()) + '.txt';
  a.click();
  URL.revokeObjectURL(url);
}
// ============ FULL DATA EXPORT / IMPORT ============
function exportAllData() {
  var data = {
    version: 'cet6_quiz_v2',
    exportTime: new Date().toLocaleString('zh-CN'),
    state: state,
    currentPool: currentPool,
    selectedUnits: selectedUnits,
    gateLevel: gateLevel,
    currentMode: currentMode,
    currentQuizType: currentQuizType,
    memory: memoryModeOn()
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'CET6_全部数据备份_' + localDateKey(new Date()) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showImportMsg('数据已导出！请将文件发送到其他设备后使用"导入数据恢复"。', 'ok');
}

function showImportMsg(msg, type) {
  // Remove any existing toast
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.className = 'toast ' + (type === 'ok' ? 'ok' : 'error');
  toast.innerHTML = msg + '<div class="toast-bar"></div>';
  document.body.appendChild(toast);

  // Auto dismiss after 3 seconds
  setTimeout(function() {
    toast.classList.add('out');
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
  }, 3000);
}

function importData() {
  document.getElementById('importFileInput').click();
}

function handleImport(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (!isPlainObject(data) || !isPlainObject(data.state) || !data.version) {
        showImportMsg('文件格式无效，请选择正确的备份文件。', 'error');
        return;
      }
      var importedState = normalizeState(data.state);

      if (!confirm(
        '即将导入以下数据：\n' +
        '• 错题记录：' + importedState.wrongHistory.length + ' 条\n' +
        '• 重做记录：' + importedState.retryHistory.length + ' 条\n' +
        '• 统计数据：' + Object.keys(importedState.stats.wordAttempts).length + ' 词的学习记录\n' +
        '• 导出时间：' + (data.exportTime || '未知') + '\n\n' +
        '导入将覆盖当前所有数据，确定继续吗？'
      )) return;

      // Merge state
      state = importedState;
      // Ensure backward compatibility
      var def = getDefaultState();
      for (var k in def) {
        if (!(k in state)) state[k] = def[k];
      }
      // 迁移：旧备份已有 ebbingStart → 视为已手动开启打卡表
      if (state.ebbingStart) state.ebbingActive = true;
      if (!state.wrongWordIds) state.wrongWordIds = {};
      ['cn2en', 'en2cn'].forEach(function(mode) {
        POOL_IDS.forEach(function(poolName) {
          if (!state.wrongWordIds[mode + '_' + poolName]) state.wrongWordIds[mode + '_' + poolName] = {};
        });
      });
      if (!state.stats.wordAttempts) state.stats.wordAttempts = {};
      if (!state.stats.dailyHistory) state.stats.dailyHistory = {};
      if (!state.stats.dictation) state.stats.dictation = { attempts: 0, correct: 0, wrong: 0, close: 0 };
      if (!state.stats.cn2en_dict) state.stats.cn2en_dict = { attempts: 0, correct: 0, wrong: 0, close: 0 };
      if (!state.stats.en2cn_dict) state.stats.en2cn_dict = { attempts: 0, correct: 0, wrong: 0, close: 0 };

      // Restore pool/mode settings
      if (isKnownPool(data.currentPool)) currentPool = data.currentPool;
      if (data.currentPool && !isKnownPool(data.currentPool)) currentPool = 'core';
      if (Array.isArray(data.selectedUnits) && data.selectedUnits.length) selectedUnits = data.selectedUnits.indexOf(0) !== -1 ? [0] : [data.selectedUnits[0]];
      if (isFinite(Number(data.gateLevel))) gateLevel = finiteInt(data.gateLevel, gateLevel, 1, 3);
      if (data.currentMode === 'cn2en' || data.currentMode === 'en2cn') currentMode = data.currentMode;
      if (data.currentQuizType === 'choice' || data.currentQuizType === 'dictation') currentQuizType = data.currentQuizType;

      // 导入后应用导入的 prefs 到内存与 UI（含题型/记忆），避免与持久化脱节被后续保存覆盖
      applyPrefs();
      savePrefs();
      updatePoolUI();
      renderAll();
      showImportMsg('数据恢复成功！', 'ok');
    } catch(err) {
      showImportMsg('文件解析失败：' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm('确定要恢复出厂设置吗？\n\n这将清除所有学习记录、错题本、统计数据、暂存进度等全部数据，且不可恢复。\n\n建议先导出一份备份。')) return;
  if (!confirm('再次确认：真的要删除所有数据吗？')) return;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.clear();
  location.reload();
}



// ============ FREQUENCY STATS RENDERING ============
function renderFreqStats() {
  // 新词库按书 Unit 统计（原频率分级统计）
  var freqGrid = document.getElementById('freqStatsGrid');
  if (!freqGrid) return;
  var st = state.stats;
  var wa = st.wordAttempts || {};
  var units = poolUnits(currentPool);
  var uLabel = poolUnitLabel(currentPool);
  var unitColors = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#ca8a04', '#9333ea', '#e11d48'];
  // 词→unit 映射（按词库）
  var wordUnitMap = {};
  var pool = getActivePool();
  pool.forEach(function(w) { wordUnitMap[w.id] = w.unit || 0; });
  var unitStats = {};
  units.forEach(function(u) {
    unitStats[u] = { attempts: 0, correct: 0, wrong: 0, words: 0 };
  });
  pool.forEach(function(w) {
    var u = w.unit || 0;
    if (unitStats[u]) unitStats[u].words++;
  });
  Object.keys(wa).forEach(function(wid) {
    if (wordPoolFromStateKey(wid) !== currentPool) return;
    var u = wordUnitMap[wordIdFromStateKey(wid)];
    if (u && unitStats[u]) {
      unitStats[u].attempts += wa[wid].attempts || 0;
      unitStats[u].correct += wa[wid].correct || 0;
      unitStats[u].wrong += wa[wid].wrong || 0;
    }
  });
  var html = '';
  units.forEach(function(u) {
    var us = unitStats[u];
    var rate = us.attempts > 0 ? Math.round(us.correct / us.attempts * 100) : 0;
    var c = unitColors[(u - 1) % unitColors.length];
    html += '<div class="fdc" style="border-left-color:' + c + '">' +
      '<div class="fdv" style="color:' + c + '">' + uLabel + ' ' + u + '</div>' +
      '<div class="fdl">词数：' + us.words + ' | 练习：' + us.attempts + '题</div>' +
      '<div class="fdl">正确率：' + rate + '% | ✅' + us.correct + ' ❌' + us.wrong + '</div>' +
      '<div class="pbar"><div class="fill" style="transform:scaleX(' + (Math.max(rate, 3)/100) + ');background:' + c + '"></div></div>' +
      '</div>';
  });
  freqGrid.innerHTML = html;
  var sec = document.getElementById('freqStatsSec');
  if (sec) {
    var h2 = sec.querySelector('h2');
    if (h2) h2.textContent = '📊 单元统计';
  }
}

// ============ POOL & UNIT FILTER UI ============
function buildUnitChips() {
  var row = document.getElementById('unitFilterRow');
  if (!row) return;
  var select = document.getElementById('unitSelect');
  if (!select) return;
  var units = POOL_META[currentPool] ? POOL_META[currentPool].units : [];
  var uLabel = poolUnitLabel(currentPool);
  var currentUnit = selectedUnits.indexOf(0) !== -1 ? 0 : (selectedUnits[0] || 0);
  select.innerHTML = '<option value="0">全部单元</option>';
  units.forEach(function(u) {
    select.insertAdjacentHTML('beforeend', '<option value="' + u + '">' + uLabel + ' ' + u + '</option>');
  });
  select.value = String(currentUnit);
}

function updatePoolUI() {
  var poolSelect = document.getElementById('poolSelect');
  if (poolSelect) poolSelect.value = currentPool;
  buildUnitChips();
  updateFreqCount();
}

function updateFreqCount() {
  var countEl = document.getElementById('freqCount');
  if (!countEl) return;
  var filtered = getActivePool() || [];
  countEl.textContent = '共 ' + filtered.length + ' 词';
}
