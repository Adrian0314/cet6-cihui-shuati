#!/usr/bin/env node
/* ============================================================
 * 本地词典抓取服务 —— 为 word-map-editor.html「＋ 添加新词」提供讲解数据
 *
 * 用法：
 *   node dict-server.js            # 默认端口 17989
 *   node dict-server.js 8888       # 指定端口
 *
 * 接口：
 *   GET /ping                      服务是否在线 → {"ok":true}
 *   GET /lookup?word=ambition      抓取有道词典讲解 → 词库讲解格式 JSON
 *
 * 数据来源：有道词典公开接口 https://dict.youdao.com/jsonapi?q=WORD
 * 解析输出字段与 cet6_quiz.html 词库讲解一致：
 *   word / pronunciation / meaning / pos / memo / example / derivative
 * （解析逻辑需与 word-map-editor.html 内的 parseYoudaoJSON 保持同步）
 * ============================================================ */
'use strict';

var http = require('http');
var https = require('https');
var URL = require('url').URL;
var fs = require('fs');
var path = require('path');

var DEFAULT_PORT = 17989;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function fetchJSON(url) {
  return new Promise(function(resolve, reject) {
    var mod = url.indexOf('https:') === 0 ? https : http;
    var req = mod.get(url, { headers: { 'User-Agent': UA, 'Referer': 'https://dict.youdao.com/' } }, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('解析返回 JSON 失败：' + body.slice(0, 160))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(new Error('请求超时')); });
  });
}

/* 音标：有道用 ˈ 主重音 / ˌ 次重音，词库用撇号 ' 表示重音，统一转换后包斜杠 */
function normalizePhonetic(ph) {
  if (!ph) return '';
  var p = String(ph).trim();
  if (!p) return '';
  p = p.replace(/ˈ/g, "'").replace(/ˌ/g, "'").replace(/'+/g, "'");
  if (p.charAt(0) !== '/') p = '/' + p + '/';
  return p;
}

function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, '').trim(); }

/* 把有道 jsonapi 响应解析成词库讲解格式（与 word-map-editor.html 的 parseYoudaoJSON 保持同步） */
function parseYoudaoJSON(j, word) {
  var out = { word: word, pronunciation: '', meaning: '', pos: '', memo: '', example: '', derivative: '' };
  var ec = j && j.ec && j.ec.word && j.ec.word[0];
  if (ec) {
    var ph = ec.ukphone || ec.usphone || '';
    if (ph) out.pronunciation = normalizePhonetic(ph);
    var ms = [];
    if (Array.isArray(ec.trs)) {
      ec.trs.forEach(function(t) {
        if (!t || !Array.isArray(t.tr)) return;
        t.tr.forEach(function(tr) {
          var l = tr && tr.l;
          if (!l) return;
          var txt = '';
          if (Array.isArray(l.i) && l.i.length) txt = l.i[0];
          else if (typeof l['#text'] === 'string') txt = l['#text'];
          txt = stripTags(txt);
          if (txt) ms.push(txt);
        });
      });
    }
    if (ms.length) {
      out.meaning = ms.join(';');
      var pm3 = out.meaning.match(/^([a-z]+(?:\/[a-z]+)*)[\.、]/i);
      if (pm3) out.pos = pm3[1].split('/')[0].toLowerCase();
    }
  }
  /* 巧记：有道词源(etym)的中文条目里，优先取「词根词缀」式短讲解——
   * 与做题站词库「构词/联想」巧记风格一致；没有词根词缀条目时取最短一条，
   * 长度压到 120 字内，不再把整段长词源放进巧记。 */
  if (j && j.etym && j.etym.etyms && Array.isArray(j.etym.etyms.zh)) {
    var zhs = [];
    j.etym.etyms.zh.forEach(function(e) { if (e && e.value) zhs.push(e); });
    var pick = null;
    zhs.forEach(function(e) { if (!pick && /词根词缀/.test(e.value)) pick = e; });
    if (!pick) zhs.forEach(function(e) { if (!pick || e.value.length < pick.value.length) pick = e; });
    if (pick) {
      var mv = String(pick.value || '').replace(/\s+/g, ' ').trim();
      if (mv) {
        mv = mv.replace(/^词根词缀[：:、\-—\s]*/, '构词 ');
        if (mv.length > 120) {
          var cut = mv.slice(0, 120);
          var cutIdx = cut.lastIndexOf('。');
          mv = (cutIdx > 20 ? cut.slice(0, cutIdx + 1) : cut) + '…';
        }
        out.memo = mv;
      }
    }
  }
  var sp = (j && j.blng_sents_part && Array.isArray(j.blng_sents_part['sentence-pair'])) ? j.blng_sents_part['sentence-pair'] : null;
  if (sp && sp[0]) {
    var en = stripTags(sp[0]['sentence']);
    var cn = stripTags(sp[0]['sentence-translation']);
    if (en) out.example = cn ? (en + ' ' + cn) : en;
  }
  if (j && j.rel_word && Array.isArray(j.rel_word.rels)) {
    var der = [];
    j.rel_word.rels.forEach(function(r) {
      if (!r || !r.rel) return;
      var pos = r.rel.pos || '';
      (Array.isArray(r.rel.words) ? r.rel.words : []).forEach(function(w) {
        if (!w || !w.word) return;
        var t = stripTags(w.tran);
        der.push(w.word + (pos ? ' ' + pos : '') + (t ? ' ' + t : ''));
      });
    });
    if (der.length) out.derivative = der.join('；');
  }
  return out;
}

function sendJSON(res, obj, status) {
  var body = JSON.stringify(obj);
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

var port = DEFAULT_PORT;
if (process.argv[2] && /^\d+$/.test(process.argv[2])) port = parseInt(process.argv[2], 10);

var server = http.createServer(function(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  var url;
  try { url = new URL(req.url, 'http://127.0.0.1:' + port); }
  catch (e) { sendJSON(res, { error: 'URL 解析失败' }, 400); return; }

  if (url.pathname === '/ping') { sendJSON(res, { ok: true }); return; }

  /* 静态文件读取（供 word-map-editor.html 一键导入本项目文件，file:// 下无法直接 fetch 本地文件） */
  if (url.pathname === '/file') {
    var p = (url.searchParams.get('p') || '').trim();
    if (!p) { sendJSON(res, { error: '缺少 p 参数，用法：/file?p=data/unit-maps.js' }, 400); return; }
    var root = path.resolve(__dirname);
    var target = path.resolve(root, p);
    var rel = path.relative(root, target);
    if (rel.split(path.sep)[0] === '..' || path.isAbsolute(rel)) {
      sendJSON(res, { error: '非法路径' }, 400);
      return;
    }
    fs.readFile(target, 'utf8', function(err, data) {
      if (err) { sendJSON(res, { error: '读取失败：' + err.message }, 404); return; }
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
    return;
  }

  /* 保存文本到本项目文件（供 word-map-editor.html「下载 unit-maps.js」后自动替换做题网站导图） */
  if (url.pathname === '/save') {
    var sp = (url.searchParams.get('p') || 'data/unit-maps.js').trim();
    var sroot = path.resolve(__dirname);
    var starget = path.resolve(sroot, sp);
    var srel = path.relative(sroot, starget);
    if (srel.split(path.sep)[0] === '..' || path.isAbsolute(srel)) {
      sendJSON(res, { error: '非法路径' }, 400);
      return;
    }
    var sbody = '';
    var tooBig = false;
    req.on('data', function(c) {
      if (sbody.length > 50 * 1024 * 1024) { tooBig = true; return; }
      sbody += c;
    });
    req.on('end', function() {
      if (tooBig) { sendJSON(res, { error: '内容超过 50MB 限制' }, 413); return; }
      if (!sbody.length) { sendJSON(res, { error: '内容为空' }, 400); return; }
      // unit-maps.js 规格要求 LF 行尾，写回前统一转换
      sbody = sbody.replace(/\r\n/g, '\n');
      fs.writeFile(starget, sbody, 'utf8', function(err) {
        if (err) { sendJSON(res, { error: '写入失败：' + err.message }, 500); return; }
        sendJSON(res, { ok: true, file: sp, bytes: Buffer.byteLength(sbody) });
      });
    });
    return;
  }

  if (url.pathname === '/lookup') {
    var word = (url.searchParams.get('word') || '').trim();
    if (!word) { sendJSON(res, { error: '缺少 word 参数，用法：/lookup?word=ambition' }, 400); return; }
    fetchJSON('https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(word))
      .then(function(j) { sendJSON(res, parseYoudaoJSON(j, word)); })
      .catch(function(e) { sendJSON(res, { error: '抓取失败：' + e.message }, 502); });
    return;
  }

  sendJSON(res, { error: '未知接口，可用 /ping 或 /lookup?word=xxx' }, 404);
});

server.listen(port, '127.0.0.1', function() {
  console.log('[dict-server] 词典抓取服务已启动：http://127.0.0.1:' + port);
  console.log('[dict-server] word-map-editor.html 「+ 添加新词」弹窗会自动调用 /lookup。');
  console.log('[dict-server] 直接测试：curl "http://127.0.0.1:' + port + '/lookup?word=ambition"');
});
