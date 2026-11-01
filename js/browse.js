/* browse.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ WORD BROWSER ============
var _browsePage = 0, _browsePageSize = 50;
// 浏览器词库：默认大纲词汇（Unit 1-14 全部 6676 词可检索），可切换核心词汇（Unit 1-10）
var _browsePool = 'core';
var _browseUnit = 0; // 0 = 全部单元
try {
  var _bpSaved = localStorage.getItem('cet6_browse_pool');
  if (isKnownPool(_bpSaved)) _browsePool = _bpSaved;
} catch (e) {}
function browsePoolWords() {
  return poolWords(_browsePool);
}
function setBrowsePool(p) {
  _browsePool = isKnownPool(p) ? p : 'core';
  _browseUnit = 0;
  _browsePage = 0;
  try { localStorage.setItem('cet6_browse_pool', _browsePool); } catch (e) {}
  renderBrowse();
}
function setBrowseUnit(u) {
  _browseUnit = Number(u) || 0;
  _browsePage = 0;
  renderBrowse();
}
function renderBrowseUnitChips() {
  var box = document.getElementById('browseUnits');
  if (!box) return;
  var maxUnit = maxUnitOfPool(_browsePool) || 14;
  var browseUnitLabel = poolUnitLabel(_browsePool);
  var html = '<span style="color:var(--text2);font-size:0.78em;">' + browseUnitLabel + '</span>' +
    '<button class="ctrl-btn' + (_browseUnit === 0 ? ' accent' : '') + '" onclick="setBrowseUnit(0)" style="padding:3px 9px;font-size:0.78em;">全部</button>';
  for (var u = 1; u <= maxUnit; u++) {
    html += '<button class="ctrl-btn' + (_browseUnit === u ? ' accent' : '') + '" onclick="setBrowseUnit(' + u + ')" style="padding:3px 9px;font-size:0.78em;">' + browseUnitLabel + ' ' + u + '</button>';
  }
  box.innerHTML = html;
  var bc = document.getElementById('browsePoolCore');
  var bf = document.getElementById('browsePoolFull');
  var bx = document.getElementById('browsePoolC1500');
  if (bc) bc.classList.toggle('accent', _browsePool === 'core');
  if (bf) bf.classList.toggle('accent', _browsePool === 'full');
  if (bx) bx.classList.toggle('accent', _browsePool === 'c1500');
}
function renderBrowse() {
  var list = document.getElementById('browseList');
  if (!list) return;
  renderBrowseUnitChips();
  if (isExternalPool(_browsePool) && !isPoolLoaded(_browsePool)) {
    var _bFailed = (_browsePool === 'c1500') ? _c1500Failed : _fullWordsFailed;
    if (_bFailed) {
      list.innerHTML = '<p style="text-align:center;color:var(--text2);padding:40px;">' + poolLabel(_browsePool) + '加载失败，请检查网络后刷新</p>';
      return;
    }
    list.innerHTML = '<p style="text-align:center;color:var(--text2);padding:40px;">词库加载中...</p>';
    ensurePool(_browsePool, function() { renderBrowse(); });
    return;
  }
  var words = browsePoolWords();
  if (!words || !words.length) { list.innerHTML = '<p style=\"text-align:center;color:var(--text2);padding:40px;\">\u8BCD\u5E93\u52A0\u8F7D\u4E2D...</p>'; return; }
  var searchEl = document.getElementById('browseSearch');
  var search = (searchEl ? searchEl.value : '') || '';
  search = search.toLowerCase();
  var filtered = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (_browseUnit > 0 && Number(w.unit) !== _browseUnit) continue;
    if (search && w.word.toLowerCase().indexOf(search) === -1 && getChinese(w.meaning).indexOf(search) === -1) continue;
    filtered.push(w);
  }
  var start = _browsePage * _browsePageSize;
  var page = filtered.slice(start, start + _browsePageSize);
  var html = '<div style="padding:8px 14px;color:var(--text2);font-size:0.8em;border-bottom:1px solid var(--border);">' +
    '共 ' + filtered.length + ' 个单词 · ' + (_browsePool === 'core' ? '大纲词汇 Unit 1-14' : '核心词汇 Unit 1-10') +
    (_browseUnit ? ' · Unit ' + _browseUnit : '') + '</div>';
  for (var j = 0; j < page.length; j++) {
    var w = page[j];
    // 词性统一 badge 渲染（多词性单词的每个词性都有独立标签）
    var posHtml = splitMeaning(w.meaning).map(function(e) {
      return (e.pos ? '<span class=\"pos-badge\" style=\"font-size:0.7em;margin-right:6px\">' + e.pos + '</span>' : '') + e.cn;
    }).join(' ');
    var _uinfo = (w.unit ? 'Unit ' + w.unit + (w.lesson ? ' · Lesson ' + w.lesson : '') + (w.group_id ? ' · 词群' + w.group_id + '「' + (w.group_name || '') + '」' : '') : '');
    var _star = w.isStar ? ' <span style=\"color:var(--accent2);font-size:0.75em\">*派生词</span>' : '';
    html += '<div style=\"padding:10px 14px;border-bottom:1px solid var(--border)\">' +
      '<div style=\"display:flex;justify-content:space-between;align-items:center\">' +
      '<span><strong>' + w.word + '</strong> <span style=\"color:var(--text2);font-size:0.85em\">' + (w.pronunciation || '') + '</span>' +
      '<span onclick=\"speakWord(&quot;' + w.word + '&quot;)\" style=\"cursor:pointer;font-size:0.95em;margin-left:8px;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;vertical-align:middle;border-radius:50%;transition:background 200ms;\" title=\"朗读发音\">\u{1F50A}</span></span>' +
      '<span><button class=\"ctrl-btn\" id=\"bdbtn-' + w.word + '\" style=\"padding:6px 12px;font-size:0.8em\" onclick=\"toggleBrowseDetail(&quot;' + w.word + '&quot;)\">\u67E5\u8BE2</button> ' +
      // 1500核心词没有词群导图数据，不显示「导图」按钮，避免点了空白
      ((_browsePool === 'c1500') ? '' : '<button class=\"ctrl-btn\" style=\"padding:6px 12px;font-size:0.8em\" onclick=\"toggleBrowseMap(&quot;' + w.word + '&quot;)\">\u{1F5FA}\uFE0F 导图</button> ') +
      '<button class=\"ctrl-btn favorite-toggle' + (isFavorite(w.id, _browsePool) ? ' active' : '') + '\" data-favorite-toggle data-favorite-key=\"' + favoriteKey(w.id, _browsePool) + '\" aria-pressed=\"' + (isFavorite(w.id, _browsePool) ? 'true' : 'false') + '\">' + (isFavorite(w.id, _browsePool) ? '★ 已标记' : '☆ 标记重点') + '</button></span></div>' +
      (_uinfo ? '<div style=\"color:var(--accent2);font-size:0.78em;margin-top:3px\">📁 ' + _uinfo + _star + '</div>' : '') +
      '<div style=\"color:var(--text2);font-size:0.85em;margin-top:2px\">' + posHtml + '</div>' +
      '<div id=\"bd-' + w.word + '\" style=\"display:none\"></div>' +
      '<div id=\"bdmap-' + w.word + '\" style=\"display:none\"></div>' +
      '</div>';
  }
  if (filtered.length > _browsePageSize) {
    var totalPages = Math.ceil(filtered.length / _browsePageSize);
    html += '<div style=\"padding:12px;text-align:center;display:flex;gap:8px;justify-content:center;align-items:center\">' +
      (_browsePage > 0 ? '<button class=\"ctrl-btn\" onclick=\"_browsePage--;renderBrowse()\">\u4E0A\u4E00\u9875</button>' : '') +
      '<span style=\"color:var(--text2);line-height:32px\">第</span>' +
      '<input type=\"number\" value=\"' + (_browsePage + 1) + '\" min=\"1\" max=\"' + totalPages + '\" style=\"width:52px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);text-align:center;font-size:0.9em;\" onkeydown=\"if(event.key===&quot;Enter&quot;){var v=parseInt(this.value);if(v>=1&&v<=' + totalPages + '){_browsePage=v-1;renderBrowse();}}\">' +
      '<span style=\"color:var(--text2);line-height:32px\">/ ' + totalPages + ' 页</span>' +
      (start + _browsePageSize < filtered.length ? '<button class=\"ctrl-btn\" onclick=\"_browsePage++;renderBrowse()\">\u4E0B\u4E00\u9875</button>' : '') +
      '</div>';
  }
  list.innerHTML = html || '<p style=\"text-align:center;color:var(--text2);padding:40px;\">\u{1F50D} \u6CA1\u6709\u5339\u914D\u7684\u5355\u8BCD</p>';
  refreshFavoriteButtons();
}

// ============ BROWSE WORD DETAIL ============
function toggleBrowseDetail(word) {
  var box = document.getElementById('bd-' + word);
  var btn = document.getElementById('bdbtn-' + word);
  if (!box || !btn) return;
  if (box.style.display === 'none') {
    if (!box.innerHTML) {
      // 按当前浏览词库精确匹配（不能用 id：各词库 id 编号体系不同会冲突）
      var pool = _browsePool;
      var arr = browsePoolWords();
      var w = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].word === word) { w = arr[i]; break; }
      }
      if (!w) {
        // 兜底：在当前词库里找不到时（如切换词库后旧列表残留）到另一词库查找
        var other = (pool === 'full') ? ((typeof ALL_WORDS !== 'undefined' && ALL_WORDS) || []) : (FULL_WORDS || []);
        for (var k = 0; k < other.length; k++) {
          if (other[k].word === word) { w = other[k]; pool = (pool === 'full') ? 'core' : 'full'; break; }
        }
      }
      var html = w ? getWordDetailHTML(w, pool) : '';
      if (w && !w.memo && !w.example) {
        // 派生词（书中以 * 标注、列在其他词条的派生词字段里）本轮不单独撰写巧记/例句，
        // 明确提示而不是留一块空白，避免看起来像功能坏了。
        html += '<div style="color:var(--text2);font-size:0.85em;padding:8px 0;">' +
          '\u{1F331} 该词是派生词，未单独撰写巧记与例句；可打开同一词群里的基词条目，结合它的巧记一起记忆。</div>';
      }
      box.innerHTML = html || '\u6682\u65E0\u8BE6\u89E3';
    }
    box.style.display = 'block';
    btn.textContent = '\u6536\u8D77';
  } else {
    box.style.display = 'none';
    btn.textContent = '\u67E5\u8BE2';
  }
}


// ============ BROWSE WORD GROUP MAP ============
// 单词浏览器中查看词的词群导图：按词在整个导图数据中定位（不受做题 currentPool 限制）
function browseGroupMapHTML(word) {
  if (!window.__UNIT_MAPS_DATA__) return '';
  for (var u in window.__UNIT_MAPS_DATA__) {
    var found = findMapGroup(window.__UNIT_MAPS_DATA__[u], word);
    if (found) {
      var id = 'gmap-' + (++_gmapSeq);
      _gmapState[id] = { unit: u, gid: found.gid, stack: found.path, active: word };
      return renderGroupMap(id);
    }
  }
  return '';
}
function toggleBrowseMap(word) {
  var box = document.getElementById('bdmap-' + word);
  if (!box) return;
  if (box.style.display === 'none') {
    if (!box.dataset.loaded) {
      box.innerHTML = '<p style="color:var(--text2);font-size:0.85em;padding:8px 0">🗺️ 词群导图加载中…</p>';
      ensureUnitMaps(function() {
        var html = browseGroupMapHTML(word);
        box.innerHTML = html || '<p style="color:var(--text2);font-size:0.85em;padding:8px 0">📖 本书词群导图暂无此词（导图数据覆盖大纲词汇 Unit 1-10）</p>';
        box.dataset.loaded = '1';
      });
    }
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

// ============ SPACED REPETITION ============
function checkSpacedRepetition() {
  if (quizActive) return; // 做题/复习中不弹窗
  if (!isGridPool(currentPool) && !state.ebbingActive) return; // 纯刷题大纲词汇：不弹复习提醒
  var due = getDueWordIds();
  if (due.length === 0) return;
  var st = state.stats;
  var now = Date.now();
  var lines, title, desc;
  if (isGridPool(currentPool)) {
    // 8格周期词库（核心词汇 / 1500核心词）
    title = '🧠 ' + poolLabel(currentPool).replace(/^[^\u4e00-\u9fff]+/, '') + '复习提醒（8格打卡）';
    desc = '以下单词已到书中的记忆周期复习点（5分/30分/12时/1天/2天/4天/7天）：';
    var dueInfo = due.slice(0, 5).map(function(id) {
      var key = wordStateKey(id, currentPool);
      var wa = st.wordAttempts[key] || {};
      var w = getWord(id, currentPool);
      return (w ? w.word : '?') + ' (' + gridProgressText(id) + ')';
    });
    lines = dueInfo.join('\n');
  } else {
    // 大纲词汇：4周25天 Unit 级
    title = '🧠 大纲词汇提醒（4周25天计划）';
    var progress = suspendedEbbingPlanProgress(state.suspendedQuiz);
    if (progress) {
      desc = '本站 4周25天计划（Unit 1-14），本轮尚未完成的学习/复习：';
      lines = (progress.units.length ? '待学习/复习 Unit ' + progress.units.join('、') + '\n' : '') +
        '已完成 ' + progress.completed + ' 题\n' +
        '待完成 ' + progress.remaining + ' 题（共 ' + progress.total + ' 题）';
    } else {
      var du = dueUnitsByEbbing();
      desc = '本站 4周25天计划（Unit 1-14），今天待学习/复习的 Unit：';
      lines = du.length ? du.map(function(unit) {
        var count = due.filter(function(id) { var w = getWord(id, 'core'); return w && Number(w.unit) === unit; }).length;
        return 'Unit ' + unit + '：待完成 ' + count + ' 题';
      }).join('\n') + '\n合计待完成 ' + due.length + ' 题' : '';
    }
  }
  if (isGridPool(currentPool) && due.length > 5) lines += '\n...还有 ' + (due.length - 5) + ' 个单词';
  var modal = document.createElement('div');
  modal.id = 'reviewReminderModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:400;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = '<div style="background:var(--surface);padding:24px;border-radius:12px;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
    '<h3>' + title + '</h3>' +
    '<p style="color:var(--text2);margin:12px 0;">' + desc + '</p>' +
    '<pre style="background:var(--surface2);padding:12px;border-radius:6px;font-size:0.85em;max-height:200px;overflow-y:auto;">' + lines + '</pre>' +
    '<div style="margin-top:16px;text-align:right;">' +
    '<button class="ctrl-btn accent" id="reviewReminderGo">\u73B0\u5728\u590D\u4E60</button>' +
    '<button class="ctrl-btn" style="margin-left:8px;" id="reviewReminderLater">\u7A0D\u540E</button></div></div>';
  document.body.appendChild(modal);
  var _rb = document.getElementById('reviewBar');
  if (_rb) _rb.classList.remove('show'); // 弹窗打开时隐藏横幅，避免遮罩下半截提示
  document.getElementById('reviewReminderGo').addEventListener('click', function() {
    modal.remove(); // 关键修复：移除整个遮罩（含弹窗）
    startReview();
  });
  document.getElementById('reviewReminderLater').addEventListener('click', function() {
    modal.remove(); // 关键修复：移除整个遮罩（含弹窗）
    if (_rb) _rb.classList.add('show'); // 恢复横幅显示
  });
}
