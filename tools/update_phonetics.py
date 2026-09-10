#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把词库里所有单词音标统一替换为有道词典的权威音标。

数据来源
    https://dict.youdao.com/jsonapi?q=<word>   →  ec.word[0].ukphone / usphone
    默认优先英式（ukphone，与四六级教材一致），没有英式时回退美式。
    抓取结果缓存在 tools/ipa_cache.json，重复运行不会重复请求（可离线跑）。

处理范围（三份词库文件 + 派生文件）
    1. cet6_quiz.html  <script id="data-all-words">  大纲词汇 6,526 词
       · pronunciation        单词本身的音标
       · derivative / example 内联音标（"word /ipa/" 形式）
       · （音标待核验）        占位符
    2. full-words.js   window.__FULL_WORDS_DATA__    核心词库 3,324 词 → pronunciation
    3. unit-maps.js    window.__UNIT_MAPS_DATA__     词群导图 3,370 个节点 → phonetic
    改完原始数据后需要再跑一次构建脚本同步派生文件：
        node build-core-words.js && node build-offline-viewer.js

解析顺序（每一步都只取"真实存在于词典"的读音，不凭空合成）
    a. 有道词条本身（含 -ise/-ize、括号变体、变体标记 "/" 等写法归一）
    b. 短语：逐词查词典后拼接（如 "life expectancy"、"dispose of"）
    c. 透明派生后缀：词干读音 + 后缀读音（-ing/-ment/-less/-like/-ness/-able/…）
    仍无法核验的内联音标只做字形降级；占位符直接去掉，绝不保留可疑读音。

用法
    python tools/update_phonetics.py            # 预览：只统计，不写文件
    python tools/update_phonetics.py --write    # 写入词库文件
"""

import argparse
import concurrent.futures as cf
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'ipa_cache.json')
API = 'https://dict.youdao.com/jsonapi?q='
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

# ---------------------------------------------------------------- 音标识别
IPA_MARKS = {chr(c) for c in range(0x0250, 0x0300)}          # IPA Extensions + 修饰符
LETTERS = ({chr(c) for c in range(0x00c0, 0x0250)}           # 拉丁扩展（含 é）
           | {chr(c) for c in range(0x0370, 0x0400)}         # 希腊字母（θ χ β）
           | {chr(c) for c in range(0x1e00, 0x1f00)})        # 带附加符的拉丁字母
DIACRITICS = {chr(c) for c in range(0x0300, 0x0370)}
ALLOWED = (set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .-()'’")
           | IPA_MARKS | DIACRITICS | LETTERS)
PENDING_TEXT = '（音标待核验）'
POS_TOKENS = {'n', 'v', 'vt', 'vi', 'adj', 'a', 'ad', 'adv', 'prep', 'pron', 'art',
              'conj', 'num', 'det', 'aux', 'int', 'phr', 'abbr', 'pl', 'vbl', 'e', 'p'}
WORD_RE = re.compile(r"[A-Za-z\u00c0-\u024f\u1e00-\u1eff\u2019'()\-]"
                     r"[A-Za-z\u00c0-\u024f\u1e00-\u1eff'\u2019()\-]*")
# 手机字体常缺字形的窄式音标符号 → 通用写法
GLYPH_FALLBACK = {'\u0279': 'r', '\u026b': 'l', '\u027b': 'r'}

# 透明派生后缀：词干读音 + 后缀读音即可，重音不迁移
SUFFIX_TAIL = [
    ('ings', 'ɪŋz'), ('ing', 'ɪŋ'),
    ('ments', 'mənts'), ('ment', 'mənt'),
    ('ness', 'nəs'), ('less', 'ləs'), ('like', 'laɪk'), ('ful', 'fl'),
    ('able', 'əbl'), ('ible', 'əbl'), ('ably', 'əbli'), ('ibly', 'əbli'),
    ('ish', 'ɪʃ'), ('ism', 'ɪzəm'), ('ist', 'ɪst'),
    ('ive', 'ɪv'), ('ial', 'əl'), ('ally', 'əli'), ('ly', 'li'),
    ('ous', 'əs'), ('al', 'əl'),
    ('er', 'ə(r)'), ('est', 'ɪst'), ('es', 'ɪz'), ('ed', 'd'), ('s', 'z'),
    ('y', 'i'),
]


def looks_ipa(s):
    """这段斜杠/方括号里的内容像不像音标（排除 him/her、and/or 这类斜杠文本）。"""
    if not s or not (2 <= len(s) <= 60):
        return False
    body = s.strip()
    if not body or not any(ch in IPA_MARKS for ch in body):
        return False
    return all(ch in ALLOWED or (ch.isascii() and ch.isdigit()) for ch in body)


def iter_ipa_spans(t):
    """产出 (start, end, kind, inner)；kind ∈ {slash, bracket, pending}。

    手写扫描而非正则：`privatise/-ize /ˈpraɪvətaɪz/` 这类"变体标记 + 音标"混排的
    文本里斜杠并不成对，正则会把 `/-ize /` 当成音标段从而错位，漏掉真正的音标。
    """
    i, n, plen = 0, len(t), len(PENDING_TEXT)
    while i < n:
        if t.startswith(PENDING_TEXT, i):
            yield (i, i + plen, 'pending', None)
            i += plen
            continue
        ch = t[i]
        if ch == '/' or ch == '[':
            close, limit = ('/', 60) if ch == '/' else (']', 40)
            b = t.find(close, i + 1)
            nl = t.find('\n', i + 1)
            if b != -1 and (nl == -1 or nl > b):
                inner = t[i + 1:b]
                if 1 <= len(inner) <= limit and looks_ipa(inner):
                    yield (i, b + 1, 'slash' if ch == '/' else 'bracket', inner)
                    i = b + 1
                    continue
        i += 1


def sanitize_ipa(t):
    t = unicodedata.normalize('NFD', t)
    t = ''.join(c for c in t if c not in DIACRITICS)
    for a, b in GLYPH_FALLBACK.items():
        t = t.replace(a, b)
    return unicodedata.normalize('NFC', t)


def strip_ipa_segments(seg):
    out, cur = [], 0
    for a, b, kind, _ in iter_ipa_spans(seg):
        if kind == 'pending':
            continue
        out.append(seg[cur:a])
        out.append(' ')
        cur = b
    out.append(seg[cur:])
    return ''.join(out)


def sanitize_text(t):
    out, cur = [], 0
    for a, b, kind, inner in iter_ipa_spans(t):
        if kind == 'pending':
            continue
        out.append(t[cur:a])
        out.append(t[a] + sanitize_ipa(inner) + t[b - 1])
        cur = b
    out.append(t[cur:])
    return ''.join(out)


def headword_before(text, pos, last_head):
    """取音标之前最近的英文单词作为词头。"""
    seg = text[:pos]
    nl = seg.rfind('\n')
    if nl >= 0:
        seg = seg[nl + 1:]
    seg = strip_ipa_segments(seg[-110:])
    for m in reversed(list(WORD_RE.finditer(seg))):
        raw = m.group(0)
        if raw.startswith('-') or raw.startswith('('):   # -ize / (ue) 这类变体标记
            continue
        w = raw.strip("-'")
        if len(w) < 3 or w.lower() in POS_TOKENS or not re.search(r'[A-Za-z]{2}', w):
            continue
        return w
    return last_head


# ---------------------------------------------------------------- 有道抓取
def _http(word):
    req = urllib.request.Request(API + urllib.parse.quote(word), headers={
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://dict.youdao.com/',
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def fetch(word, tries=3):
    for i in range(tries):
        try:
            ec = (_http(word).get('ec') or {})
            for w in (ec.get('word') or []):
                uk = (w.get('ukphone') or '').strip()
                us = (w.get('usphone') or '').strip()
                if uk or us:
                    return {'uk': uk or None, 'us': us or None}
            return {'uk': None, 'us': None}
        except Exception:
            if i == tries - 1:
                return {'uk': None, 'us': None}
            time.sleep(0.6 * (i + 1))
    return {'uk': None, 'us': None}


def candidates(word):
    """归一化后的查询写法，最规范的排在最前。"""
    w = unicodedata.normalize('NFKC', str(word)).strip().replace('\u2019', "'")
    out = []
    if '/' in w:
        head = w.split('/')[0].strip()
        out += [head, head.replace('isation', 'ization').replace('ise', 'ize')
                .replace('yse', 'yze')]
    out.append(w)
    stripped = re.sub(r'\([^)]*\)', '', w).strip()
    expanded = re.sub(r'\(([A-Za-z]+)\)', r'\1', w).strip()
    out += [stripped, expanded]
    for s in (w, stripped, expanded):
        out.append(s.replace('isation', 'ization').replace('ise', 'ize')
                   .replace('yse', 'yze'))
    if '-' in w:
        out += [w.replace('-', ' '), w.replace('-', '')]
    nk = unicodedata.normalize('NFKD', w)
    out.append(''.join(c for c in nk if not unicodedata.combining(c)))
    out += [s.lower() for s in list(out)]
    seen, uniq = set(), []
    for s in out:
        s = s.strip()
        if s and s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


def split_camel(word):
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', word)


class Resolver:
    def __init__(self, cache):
        self.cache = cache

    def raw(self, word):
        for c in candidates(word):
            e = self.cache.get(c)
            if e and (e.get('uk') or e.get('us')):
                return (e.get('uk') or e.get('us')).strip()
        return None

    def _phrase(self, word):
        parts = [p for p in re.split(r'[\s\-]+', split_camel(word)) if p]
        if len(parts) < 2:
            return None
        out = []
        for p in parts:
            v = self.raw(p) or self._derived(p)
            if not v:
                return None
            out.append(v.split(';')[0].strip())
        return ' '.join(out)

    def _derived(self, word):
        lw = word.lower()
        for suf, tail in SUFFIX_TAIL:
            if not lw.endswith(suf) or len(lw) - len(suf) < 3:
                continue
            stem = word[:len(word) - len(suf)]
            bases = [stem, stem + 'e', stem + 'y']
            if len(stem) > 2 and stem[-1] == stem[-2]:
                bases.append(stem[:-1])
            for b in bases:
                v = self.raw(b)
                if v:
                    return v + tail
        return None

    def resolve(self, word):
        """返回 '/ipa/'；无法核验时返回空串。"""
        if not word or not re.search(r'[A-Za-z]', word):
            return ''
        v = self.raw(word) or self._phrase(word) or self._derived(word)
        if not v:
            return ''
        return '/' + re.sub(r'\s+', ' ', v).strip() + '/'


# ---------------------------------------------------------------- 词库读写
def load_banks():
    html = open(os.path.join(ROOT, 'cet6_quiz.html'), encoding='utf-8').read()
    bm = re.search(r'(<script type="application/json" id="data-all-words">)([\s\S]*?)(</script>)', html)
    outline = json.loads(bm.group(2))

    fw = open(os.path.join(ROOT, 'full-words.js'), encoding='utf-8').read()
    fm = re.search(r'(window\.__FULL_WORDS_DATA__\s*=\s*)(\[[\s\S]*\])(;?)', fw)
    full = json.loads(fm.group(2))

    um = open(os.path.join(ROOT, 'unit-maps.js'), encoding='utf-8').read()
    eq = um.index('=')
    maps = json.loads(um[eq + 1:].strip().rstrip(';'))
    return html, bm, outline, fw, fm, full, um, eq, maps


def map_nodes(maps):
    out = []

    def walk(nodes):
        for n in nodes:
            out.append(n)
            walk(n.get('children') or [])
    for unit in maps.values():
        for lesson in unit.values():
            walk(lesson.get('level1Nodes') or [])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='写入词库文件')
    ap.add_argument('--workers', type=int, default=8)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')

    html, bm, outline, fw, fm, full, um, eq, maps = load_banks()
    nodes = map_nodes(maps)

    # 1) 收集所有需要音标的词头
    headwords = set()
    for e in outline:
        headwords.add(e['word'])
        for f in ('derivative', 'example'):
            v = e.get(f)
            if isinstance(v, str):
                last = None
                for a, b, kind, inner in iter_ipa_spans(v):
                    h = headword_before(v, a, last)
                    if h:
                        last = h
                        headwords.add(h)
    for e in full:
        headwords.add(e['word'])
    for n in nodes:
        w = n.get('word', '')
        if re.search(r'[A-Za-z]', w) and not re.search(r'[\u3400-\u9fff]', w):
            headwords.add(w)
        v = n.get('meaning')
        if isinstance(v, str):
            last = None
            for a, b, kind, inner in iter_ipa_spans(v):
                h = headword_before(v, a, last)
                if h:
                    last = h
                    headwords.add(h)
    headwords = {w for w in headwords if re.search(r'[A-Za-z]', w)}
    print('需要音标的词头：%d' % len(headwords))

    # 2) 补抓缺失词条
    cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}
    resolver = Resolver(cache)
    todo = sorted(w for w in headwords if not resolver.resolve(w))
    print('需要联网抓取：%d' % len(todo))
    if todo:
        lock, done, n = threading.Lock(), [], [0]

        def work(w):
            for c in candidates(w):
                if c not in cache:
                    r = fetch(c)
                    with lock:
                        cache[c] = r
                if cache[c].get('uk') or cache[c].get('us'):
                    break
            with lock:
                n[0] += 1
                if n[0] % 200 == 0:
                    json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
                    print('  ...%d/%d' % (n[0], len(todo)), flush=True)
            return w

        with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
            list(ex.map(work, todo))
        json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
    print('缓存词条：%d' % len(cache))

    # 3) 改写
    stats = {'outline': 0, 'full': 0, 'maps': 0, 'slash': 0, 'bracket': 0,
             'pending': 0, 'dropped': 0}
    unresolved = {}

    def need(word):
        ph = resolver.resolve(word)
        if not ph and word:
            unresolved[word] = unresolved.get(word, 0) + 1
        return ph

    for e in outline:
        e['pronunciation'] = need(e['word'])
        if e['pronunciation']:
            stats['outline'] += 1
        for f in ('derivative', 'example'):
            v = e.get(f)
            if not isinstance(v, str) or not ('/' in v or '[' in v or PENDING_TEXT in v):
                continue
            out, last, cur = [], None, 0
            for a, b, kind, inner in iter_ipa_spans(v):
                h = headword_before(v, a, last)
                ph = need(h) if h else ''
                if ph:
                    last = h
                    out.append(v[cur:a])
                    out.append(' ' + ph if kind == 'pending'
                               else ph if kind == 'slash'
                               else '[' + ph.strip('/') + ']')
                    stats[kind] += 1
                    cur = b
            out.append(v[cur:])
            text = ''.join(out)
            stats['dropped'] += text.count(PENDING_TEXT)
            e[f] = sanitize_text(text.replace(' ' + PENDING_TEXT, '').replace(PENDING_TEXT, ''))

    for e in full:
        e['pronunciation'] = need(e['word'])
        if e['pronunciation']:
            stats['full'] += 1

    for n in nodes:
        ph = need(n.get('word', ''))
        if ph:
            n['phonetic'] = ph
            stats['maps'] += 1

    print('大纲词汇音标：%d/%d' % (stats['outline'], len(outline)))
    print('核心词库音标：%d/%d' % (stats['full'], len(full)))
    print('导图节点音标：%d/%d' % (stats['maps'], len(nodes)))
    print('内联音标改写：/…/ %d，[…] %d，占位符 %d，丢弃占位符 %d'
          % (stats['slash'], stats['bracket'], stats['pending'], stats['dropped']))
    if unresolved:
        print('无法核验的词头（保持原样）：%d' % len(unresolved))
        for w in sorted(unresolved)[:40]:
            print('   ', w)

    if not args.write:
        print('\n[预览模式] 未写入文件；加 --write 执行')
        return

    html = html[:bm.start(2)] + json.dumps(outline, ensure_ascii=False, separators=(',', ':')) + html[bm.end(2):]
    open(os.path.join(ROOT, 'cet6_quiz.html'), 'w', encoding='utf-8', newline='').write(html)

    fw = fw[:fm.start(2)] + json.dumps(full, ensure_ascii=False, separators=(',', ':')) + fw[fm.end(2):]
    open(os.path.join(ROOT, 'full-words.js'), 'w', encoding='utf-8', newline='').write(fw)

    um = um[:eq + 1] + json.dumps(maps, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(os.path.join(ROOT, 'unit-maps.js'), 'w', encoding='utf-8', newline='').write(um)
    print('\n已写入 cet6_quiz.html / full-words.js / unit-maps.js')
    print('请再执行：node build-core-words.js && node build-offline-viewer.js')


if __name__ == '__main__':
    main()
