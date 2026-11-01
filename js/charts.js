/* charts.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ CHARTS ============
function isDarkMode() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
var _chartInstances = {};
function destroyCharts() {
  Object.keys(_chartInstances).forEach(function(k) {
    if (_chartInstances[k]) { _chartInstances[k].destroy(); _chartInstances[k] = null; }
  });
  _chartInstances = {};
}

function renderAllCharts() {
  destroyCharts();
  if (document.getElementById('tab-stats-page').style.display === 'none') return;
  var chartOk = window._chartAvailable;
  // Canvas2D charts work independently
  renderHeatmapChart();
  renderCoverageRing();
  // Chart.js charts need the library
  if (chartOk) {
    renderRadarChart();
    renderTrendChart();
    renderTypeBarChart();
  } else {
    var charts = ['radarChart', 'trendChart', 'typeBarChart'];
    charts.forEach(function(id) {
      var c = document.getElementById(id);
      if (!c) return;
      var p = c.parentElement;
      if (p && !p.querySelector('.chart-fallback')) {
        var fb = document.createElement('div');
        fb.className = 'chart-fallback';
        fb.style.cssText = 'text-align:center;padding:40px 16px;color:var(--text2);font-size:0.9em;';
        fb.innerHTML = '\u{1F4CA} \u56FE\u8868\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5';
        p.insertBefore(fb, c.nextSibling);
      }
      c.style.display = 'none';
    });
  }
}

function setDailyGoal() {
  var inp = document.getElementById('goalInput');
  if (!inp) return;
  var v = parseInt(inp.value);
  if (isNaN(v) || v < 1) { alert('请输入至少 1 的数值'); return; }
  if (v > 1000) { v = 1000; }
  state.dailyGoal = v;
  saveState();
  renderStatsPage();
  renderHeatmapChart();
  var msg = document.getElementById('goalMsg');
  if (msg) {
    msg.textContent = '✅ 已保存：每日 ' + v + ' 题（做题+复习都计入）';
    setTimeout(function() { msg.textContent = ''; }, 3000);
  }
}

var _heatDays = 90;  // 热力图时间范围（30/90/180/365）
var _heatCells = []; // 格子命中检测记录
var _heatTipDate = null; // 固定显示的 tooltip 日期（点按模式）

function heatStreakFrom(dateKey) {
  var n = 0;
  var d = new Date(dateKey + 'T12:00:00');
  var dh = state.stats.dailyHistory || {};
  while (true) {
    var k = localDateKey(d);
    var e = dh[k];
    if (e && (e.attempts || 0) > 0) { n++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return n;
}

function showHeatmapTip(cell, px, py, pin) {
  var tip = document.getElementById('heatmapTip');
  if (!tip || !cell) return;
  var dh = state.stats.dailyHistory || {};
  var dd = dh[cell.date] || { attempts: 0, correct: 0, wrong: 0 };
  var at = dd.attempts || 0;
  var co = dd.correct || 0;
  var wr = dd.wrong || 0;
  var goal = state.dailyGoal || 30;
  var rate = at > 0 ? Math.round(100 * co / at) : 0;
  var met = at >= goal;
  var d = new Date(cell.date + 'T12:00:00');
  var wd = ['日','一','二','三','四','五','六'][d.getDay()];
  var rateColor = rate >= 80 ? '#16a34a' : (rate >= 50 ? '#d97706' : '#dc2626');
  var rateFace = rate >= 80 ? '👍' : (rate >= 50 ? '👌' : '💪');
  tip.innerHTML =
    '<b>' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + wd + '</b><br>' +
    '做题 ' + at + ' 题（答对 ' + co + ' · 答错 ' + wr + '）<br>' +
    '正确率 ' + rate + '%' + (at > 0 ? ' <span style="color:' + rateColor + '">' + rateFace + '</span>' : '') + '<br>' +
    (met ? '<span style="color:#16a34a">✓ 已达标</span>' : '<span style="color:var(--text2)">未达标（' + at + ' / ' + goal + '）</span>') +
    ' · 连续打卡 <b>' + heatStreakFrom(cell.date) + '</b> 天';
  tip.style.display = 'block';
  var wrap = tip.parentElement;
  var tw = tip.offsetWidth;
  var th = tip.offsetHeight;
  var x = px + 10;
  if (x + tw > wrap.clientWidth - 4) x = px - tw - 10;
  if (x < 4) x = 4;
  var y = py - 10;
  if (y + th > wrap.clientHeight - 4) y = wrap.clientHeight - th - 4;
  if (y < 4) y = 4;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
  if (pin) _heatTipDate = cell.date;
}

function hideHeatmapTip() {
  var tip = document.getElementById('heatmapTip');
  if (tip) tip.style.display = 'none';
  _heatTipDate = null;
}

function hitHeatCell(px, py) {
  for (var i = 0; i < _heatCells.length; i++) {
    var c = _heatCells[i];
    if (px >= c.x && px <= c.x + c.size && py >= c.y && py <= c.y + c.size) return c;
  }
  return null;
}

function renderHeatmapChart() {
  var canvas = document.getElementById('heatmapChart');
  if (!canvas) return;
  // 高分屏适配：按 devicePixelRatio 放大画布物理像素，避免小字模糊
  var dpr = window.devicePixelRatio || 1;
  var wrap = canvas.parentElement;
  var w = wrap.clientWidth;
  if (w < 200) w = 200;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(200 * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = '200px';
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, 200);
  hideHeatmapTip();

  var dark = isDarkMode();
  var labelColor = dark ? '#94a3b8' : '#888';
  var emptyColor = dark ? '#334155' : '#e5e5e5';
  var borderColor = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  var today = new Date();
  var days = _heatDays;
  var cols = Math.ceil(days / 7);
  var cellGap = 2;
  var startX = 30;
  var availW = w - startX - 8;
  var cellSize = Math.floor((availW - (cols - 1) * cellGap) / cols);
  if (cellSize < 4) cellSize = 4;
  var maxCell = Math.floor((158 - 26) / 7); // 高度上限：底部图例区之前
  if (cellSize > maxCell) cellSize = maxCell;

  var weekdays = ['日','一','二','三','四','五','六'];
  ctx.font = '10px sans-serif';
  for (var wi = 0; wi < 7; wi++) {
    var ly = 26 + wi * (cellSize + cellGap);
    ctx.fillStyle = labelColor;
    ctx.fillText(weekdays[wi], 5, ly + cellSize - 2);
  }

  var goal = state.dailyGoal || 30;
  var dh = state.stats.dailyHistory || {};
  _heatCells = [];

  for (var d = days - 1; d >= 0; d--) {
    var dt = new Date(today);
    dt.setDate(dt.getDate() - d);
    var key = localDateKey(dt);
    var dd = dh[key] || { attempts: 0, correct: 0, wrong: 0 };
    var count = dd.attempts || 0;
    var corr = dd.correct || 0;

    var col = Math.floor((days - 1 - d) / 7);
    var row = dt.getDay(); // 0=Sun
    var x = startX + col * (cellSize + cellGap);
    var y = 26 + row * (cellSize + cellGap);

    // 颜色档位跟随每日目标：0 / 未达1/3 / 未达标 / 达标（深绿）
    var color = emptyColor;
    if (count > 0) color = '#bbf7d0';
    if (count >= Math.ceil(goal / 3)) color = '#4ade80';
    if (count >= goal) color = '#16a34a';

    ctx.fillStyle = color;
    ctx.fillRect(x, y, cellSize, cellSize);
    ctx.strokeStyle = borderColor;
    ctx.strokeRect(x, y, cellSize, cellSize);

    // 正确率圆点：绿≥80% / 黄50-80% / 红<50%；格子太小或纯复习（无答题记录）则省略
    if (cellSize >= 7 && count > 0 && corr > 0) {
      var rate = corr / count;
      var dotC = '#ef4444';
      if (rate >= 0.8) dotC = '#22c55e';
      else if (rate >= 0.5) dotC = '#eab308';
      ctx.fillStyle = dotC;
      ctx.beginPath();
      ctx.arc(x + cellSize - Math.max(2, cellSize * 0.22), y + Math.max(2, cellSize * 0.22), Math.max(1.5, cellSize * 0.14), 0, Math.PI * 2);
      ctx.fill();
    }

    _heatCells.push({ x: x, y: y, size: cellSize, date: key, count: count, correct: corr });
  }

  // 底部图例：做题量档位 + 正确率圆点三色（与最后一行格子保持 4px+ 间距）
  ctx.fillStyle = labelColor;
  ctx.font = '10px sans-serif';
  ctx.fillText('做题量', 5, 174);
  [{ c: emptyColor, t: '0' }, { c: '#bbf7d0', t: '少量' }, { c: '#4ade80', t: '中量' }, { c: '#16a34a', t: '达标' }].forEach(function(li, i) {
    var lx = 36 + i * 48;
    ctx.fillStyle = li.c;
    ctx.fillRect(lx, 166, 8, 8);
    ctx.strokeStyle = borderColor;
    ctx.strokeRect(lx, 166, 8, 8);
    ctx.fillStyle = labelColor;
    ctx.fillText(li.t, lx + 11, 174);
  });
  ctx.fillText('正确率', 5, 194);
  [{ c: '#22c55e', t: '≥80%' }, { c: '#eab308', t: '50-80%' }, { c: '#ef4444', t: '<50%' }].forEach(function(li, i) {
    var lx = 36 + i * 60;
    ctx.fillStyle = li.c;
    ctx.beginPath();
    ctx.arc(lx + 4, 186, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = labelColor;
    ctx.fillText(li.t, lx + 11, 194);
  });

  // 交互绑定（一次性）：悬停/点按显示详情
  if (!canvas._hmBound) {
    canvas._hmBound = true;
    canvas.addEventListener('mousemove', function(e) {
      var r = canvas.getBoundingClientRect();
      var cell = hitHeatCell(e.clientX - r.left, e.clientY - r.top);
      if (cell) showHeatmapTip(cell, e.clientX - r.left, e.clientY - r.top, false);
      else if (!_heatTipDate) hideHeatmapTip();
    });
    canvas.addEventListener('mouseleave', function() { if (!_heatTipDate) hideHeatmapTip(); });
    canvas.addEventListener('click', function(e) {
      var r = canvas.getBoundingClientRect();
      var cell = hitHeatCell(e.clientX - r.left, e.clientY - r.top);
      if (cell) showHeatmapTip(cell, e.clientX - r.left, e.clientY - r.top, true);
    });
    canvas.addEventListener('touchstart', function(e) {
      var t = e.touches[0];
      var r = canvas.getBoundingClientRect();
      var cell = hitHeatCell(t.clientX - r.left, t.clientY - r.top);
      if (cell) showHeatmapTip(cell, t.clientX - r.left, t.clientY - r.top, true);
      else hideHeatmapTip();
    }, { passive: true });
    document.addEventListener('click', function(e) {
      if (!e.target.closest || !e.target.closest('#heatmapChart')) hideHeatmapTip();
    });
  }
}

function renderRadarChart() {
  var canvas = document.getElementById('radarChart');
  if (!canvas) return;

  var st = window.state ? window.state.stats : state.stats;
  var wa = st.wordAttempts || {};

  // 按当前词库的单元统计（原频率雷达）
  // 单元过多（如 1500核心词的 List 1-50）时按区间合并，避免 50 根雷达轴挤在一起
  var allUnits = poolUnits(currentPool);
  var poolIdx = POOL_IDS.indexOf(currentPool);
  var unitPrefix = ['U', 'U', 'L'][poolIdx >= 0 ? poolIdx : 1] || 'U';
  var buckets = [];
  if (allUnits.length > 14) {
    var groupSize = Math.ceil(allUnits.length / 10);
    for (var bi = 0; bi < allUnits.length; bi += groupSize) {
      buckets.push(allUnits.slice(bi, bi + groupSize));
    }
  } else {
    allUnits.forEach(function(u) { buckets.push([u]); });
  }
  var units = buckets;
  var names = buckets.map(function(group) {
    return group.length > 1
      ? unitPrefix + group[0] + '-' + group[group.length - 1]
      : unitPrefix + group[0];
  });
  var mastery = [];

  units.forEach(function(unit) {
    var correct = 0, total = 0;
    var group = Array.isArray(unit) ? unit : [unit];
    Object.keys(wa).forEach(function(wid) {
      if (wordPoolFromStateKey(wid) !== currentPool) return;
      var w = getWord(wordIdFromStateKey(wid), currentPool);
      if (w && group.indexOf(w.unit || 0) !== -1) {
        correct += wa[wid].correct || 0;
        total += wa[wid].attempts || 0;
      }
    });
    mastery.push(total > 0 ? Math.round(correct / total * 100) : 0);
  });

  _chartInstances.radar = new Chart(canvas, {
    type: 'radar',
    data: {
      labels: names,
      datasets: [{
        label: '掌握率 %',
        data: mastery,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.15)',
        borderWidth: 2,
        pointBackgroundColor: '#7c3aed',
        pointBorderColor: '#fff',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 20, fontSize: 10 },
          pointLabels: { fontSize: 10 }
        }
      },
      plugins: { legend: { display: false } }
    }
  });
}

function renderCoverageRing() {
  var canvas = document.getElementById('coverageRing');
  if (!canvas) return;

  var st = window.state ? window.state.stats : state.stats;
  var wa = st.wordAttempts || {};
  var activePool = getActivePool();
  var totalWords = activePool.length;

  var mastered = 0;
  var uniqueAttempted = 0;
  Object.keys(wa).forEach(function(wid) {
    if (wordPoolFromStateKey(wid) !== currentPool) return;
    var wd = wa[wid];
    uniqueAttempted++;
    var acc = wd.attempts > 0 ? wd.correct / wd.attempts : 0;
    if (acc >= 0.7 && wd.attempts >= 2) mastered++;
  });

  var masteredPct = totalWords > 0 ? Math.round(mastered / totalWords * 100) : 0;

  var dark = isDarkMode();
  // 高分屏适配：按 devicePixelRatio 放大画布物理像素，避免文字模糊
  var dpr = window.devicePixelRatio || 1;
  var cw = canvas.parentElement.clientWidth - 40;
  if (cw < 200) cw = 200;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(220 * dpr);
  canvas.style.width = cw + 'px';
  canvas.style.height = '220px';
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var cx = cw / 2;
  var cy = 110;
  var radius = 80;
  var lineWidth = 18;

  ctx.clearRect(0, 0, cw, 220);

  // Gray background ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = dark ? '#334155' : '#e5e5e5';
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // Green mastery ring
  if (masteredPct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * masteredPct / 100));
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Center text
  ctx.fillStyle = dark ? '#e2e8f0' : '#1a1a1a';
  ctx.font = 'bold 22px -apple-system,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('已掌握 ' + masteredPct + '%', cx, cy - 6);
  ctx.fillStyle = dark ? '#94a3b8' : '#737373';
  ctx.font = '12px -apple-system,sans-serif';
  ctx.fillText(mastered + ' / ' + totalWords + ' 词', cx, cy + 18);
  ctx.fillText('已练习 ' + uniqueAttempted + ' 词', cx, cy + 36);
}

function renderTrendChart() {
  var canvas = document.getElementById('trendChart');
  if (!canvas) return;

  var st = window.state ? window.state.stats : state.stats;
  var dh = st.dailyHistory || {};
  var days = [];
  var today = new Date();

  for (var d = 6; d >= 0; d--) {
    var dt = new Date(today);
    dt.setDate(dt.getDate() - d);
    var key = localDateKey(dt);
    var ds = dh[key] || { attempts: 0, correct: 0, wrong: 0, dict_attempts: 0, dict_correct: 0 };
    var choiceRate = ds.attempts > 0 ? Math.round(ds.correct / ds.attempts * 100) : null;
    var dcA = ds.dict_attempts || 0;
    var dcC = ds.dict_correct || 0;
    var dictRate = dcA > 0 ? Math.round(dcC / dcA * 100) : null;
    days.push({
      label: key.slice(5),
      choiceRate: choiceRate,
      dictRate: dictRate
    });
  }

  _chartInstances.trend = new Chart(canvas, {
    type: 'line',
    data: {
      labels: days.map(function(x) { return x.label; }),
      datasets: [
        {
          label: '选择题正确率',
          data: days.map(function(x) { return x.choiceRate; }),
          borderColor: '#7c3aed',
          backgroundColor: 'transparent',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 4,
          spanGaps: true
        },
        {
          label: '默写题正确率',
          data: days.map(function(x) { return x.dictRate; }),
          borderColor: '#059669',
          backgroundColor: 'transparent',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 4,
          borderDash: [5, 3],
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: { min: 0, max: 100, ticks: { callback: function(v) { return v + '%'; } } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16 } }
      }
    }
  });

}

function renderTypeBarChart() {
  var canvas = document.getElementById('typeBarChart');
  if (!canvas) return;

  var st = window.state ? window.state.stats : state.stats;
  var cn2en = st.cn2en || { attempts: 0, correct: 0 };
  var en2cn = st.en2cn || { attempts: 0, correct: 0 };
  var cd = st.cn2en_dict || { attempts: 0, correct: 0 };
  var ed = st.en2cn_dict || { attempts: 0, correct: 0 };

  _chartInstances.typeBar = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['CN→EN选择', 'EN→CN选择', 'CN→EN默写', 'EN→CN默写'],
      datasets: [
        {
          label: '总题数',
          data: [cn2en.attempts, en2cn.attempts, cd.attempts, ed.attempts],
          backgroundColor: 'rgba(124,58,237,0.3)',
          borderColor: '#7c3aed',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: '正确数',
          data: [cn2en.correct, en2cn.correct, cd.correct, ed.correct],
          backgroundColor: 'rgba(124,58,237,0.8)',
          borderColor: '#7c3aed',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16 } }
      }
    }
  });
}

// ============ FULLSCREEN TOGGLE ============
function toggleFullscreen() {
  var card = document.getElementById('quizCard');
  var btn = document.getElementById('toggleFsBtn');
  if (!card) return;
  var isFS = card.classList.contains('fullscreen');
  if (isFS) {
    card.classList.remove('fullscreen');
    if (btn) btn.textContent = '⛶ 全屏';
    document.body.style.overflow = '';
    var tabsEl = document.querySelector('.tabs');
    if (tabsEl) { tabsEl.style.display = ''; tabsEl.style.zIndex = ''; }
  } else {
    card.classList.add('fullscreen');
    if (btn) btn.textContent = '⛶ 退出全屏';
    document.body.style.overflow = 'hidden';
    var tabsEl2 = document.querySelector('.tabs');
    if (tabsEl2) { tabsEl2.style.zIndex = '0'; }
  }
  if (typeof onScrollCheck === 'function') onScrollCheck();
}
