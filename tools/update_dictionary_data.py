"""Apply source-backed IPA; never synthesize pronunciations or reuse unverified OCR.
Usage: python tools/update_dictionary_data.py CACHE/prepared.json [--root SITE]
Each selected value includes the original sound record and a dictionary permalink.
"""
import argparse,json,re
from pathlib import Path
from urllib.parse import quote
from extract_dictionary_ipa import ROOT,variants,nodes
FOOTER=re.compile(r'第\s*\d+\s*页\s*[,，]?\s*共\s*\d+\s*页')
SPELLINGS={'voit':'volt','disappointinging':'disappointing'}
POS={'n':'noun','v':'verb','vt':'verb','vi':'verb','adj':'adj','a':'adj','ad':'adv','adv':'adv','prep':'prep','pron':'pron','art':'article','conj':'conj','num':'num','det':'det','aux':'verb','int':'intj'}
def normalize(ipa):
 s=ipa.strip()
 if s.startswith('\\') and s.endswith('\\'):s='/'+s[1:-1]+'/'
 if any(x in s for x in ['…','...','�','{','}','?','-','，',';']):return None
 if re.search(r'[\u3400-\u9fff0-9]',s):return None
 if s.startswith(('/','[')):
  if not s.endswith('/' if s[0]=='/' else ']'):return None
  inner=s[1:-1]
 else:inner=s;s='/'+s+'/'
 if not inner.strip() or '/' in inner or '\\' in inner:return None
 return s

def choose(word,db):
 name=SPELLINGS.get(word['word'],word['word']); vv=variants(name)
 # Case alternatives are explicitly recorded, never used to change displayed spelling.
 vv=list(dict.fromkeys(vv+[v.lower() for v in vv]))
 candidates=[]
 for v in vv:
  for resolved in [v]+db['aliases'].get(v,[]):
   for entry in db['entries'].get(resolved,[]):
    for sound in entry['sounds']:
     ipa=normalize(sound['ipa'])
     if not ipa:continue
     tags=' '.join(sound.get('tags',[])+sound.get('raw_tags',[]))
     if re.search(r'archaic|obsolete|historical|dated|nonstandard|phoneme',tags,re.I):continue
     dialect=0 if re.search(r'Received-Pronunciation|Britain|UK|Royaume-Uni|брит',tags,re.I) else 1 if not tags else 2 if re.search(r'General-American|US|États-Unis|амер',tags,re.I) else 3
     rank=(['en','fr','de','ru','zh','es','pl','simple'].index(entry['edition']),ipa.startswith('['),dialect, resolved!=v)
     candidates.append((rank,{'ipa':ipa,'headword':resolved,'pos':entry.get('pos'),'edition':entry['edition'],'source':'https://'+entry['edition']+'.wiktionary.org/wiki/'+quote(resolved,safe=''),'original':sound,'via':v if resolved!=v else None}))
 expected=list(dict.fromkeys(POS[p.lower()] for p in re.findall(r'\b(n|vt|vi|v|adj|adv|prep|pron|art|conj|num|det|aux|int)\.',str(word.get('pos',''))+' '+str(word.get('meaning',''))) if p.lower() in POS))
 if name.lower()=='a':expected=['article']
 selected=[]
 for pos in expected or [None]:
  options=[c for c in candidates if pos is None or c[1]['pos']==pos]
  if options:
   evidence=min(options,key=lambda c:c[0])[1]
   if not any(x['ipa']==evidence['ipa'] for x in selected):selected.append(evidence)
 # Missing POS is explicit in evidence; no inflection/base-word fallback.
 if not selected and candidates:selected=[min(candidates,key=lambda c:c[0])[1]]
 return selected

def format_readings(evidence):
 labels={'noun':'n.','verb':'v.','adj':'adj.','adv':'adv.','article':'art.','prep':'prep.','pron':'pron.','det':'det.','conj':'conj.','num':'num.'}
 return ' · '.join((labels.get(e['pos'],e['pos'] or '')+' ' if len(evidence)>1 else '')+e['ipa'] for e in evidence)

INLINE=re.compile(r"([A-Za-z][A-Za-z'’()/-]*)\s+(/[^/\u3400-\u9fff\n]+/)")
RAW_IPA=re.compile(r'/[^/\u3400-\u9fff\n]+/')
def clean_inline(w,db,audit,key):
 for field in ['derivative','example','meaning','memo']:
  if not isinstance(w.get(field),str):continue
  text=w[field]
  if field in ['derivative','example']:
   def replace(m):
    tail=text[m.end():];ev=choose({'word':m[1],'meaning':tail.split('\n')[0]},db)
    audit.setdefault('inline_evidence',[]).append({'parent':key,'field':field,'word':m[1],'readings':ev})
    return m[1]+' '+(format_readings(ev) if ev else '（音标待核验）')
   w[field]=INLINE.sub(replace,text)
  elif field=='meaning':
   w[field]=RAW_IPA.sub(' ',text)
  elif RAW_IPA.search(text):
   # Mnemonics sometimes explicitly endorse OCR-corrupt pronunciations. Do not
   # retain or mechanically rewrite that advice with a potentially different POS.
   audit.setdefault('removed_ipa_mnemonics',[]).append({'parent':key,'old':text})
   w[field]='发音请以词条的已核验音标及词典来源为准；原巧记含未核验读音，已停用。'

def main():
 ap=argparse.ArgumentParser();ap.add_argument('cache');ap.add_argument('--root',type=Path,default=ROOT);args=ap.parse_args()
 root=args.root; data=root/'data' if (root/'data/full-words.js').exists() else root
 db=json.loads(Path(args.cache).read_text('utf-8'))
 hp=root/'cet6_quiz.html';html=hp.read_text('utf-8');m=re.search(r'(id="data-all-words">)(.*?)(</script>)',html,re.S);core=json.loads(m[2])
 fp=data/'full-words.js';text=fp.read_text('utf-8');fm=re.search(r'(__FULL_WORDS_DATA__\s*=\s*)(\[.*\])',text,re.S);full=json.loads(fm[2])
 mp=data/'unit-maps.js';mt=mp.read_text('utf-8');maps=json.loads(mt[mt.index('=')+1:].strip().rstrip(';'))
 audit={'date':'2026-09-08','source':'Wiktionary via Kaikki/wiktextract','counts':{},'footer_repairs':[],'spelling_repairs':[],'missing':[],'evidence':{}}
 for bank,words,field in [('outline',core,'pronunciation'),('core',full,'pronunciation'),('maps',list(nodes(maps)),'phonetic')]:
  verified=missing=0
  for w in words:
   if not re.search('[A-Za-z]',w['word']) or re.search(r'[㐀-鿿]',w['word']):continue
   old=w['word']
   if old in SPELLINGS:w['word']=SPELLINGS[old];audit['spelling_repairs'].append({'bank':bank,'id':w.get('id'),'old':old,'new':w['word']})
   if 'meaning' in w and FOOTER.search(w['meaning']):
    audit['footer_repairs'].append({'bank':bank,'word':w['word'],'old':w['meaning']});w['meaning']=FOOTER.sub('',w['meaning']).strip()
   evidence=choose(w,db)
   key=bank+':'+str(w.get('id',w['word']))
   if evidence:
    w[field]=format_readings(evidence)
    w['ipaSource']=evidence[0]['source'];w['ipaStatus']='verified';verified+=1
    audit['evidence'][key]={'word':w['word'],'pronunciation':w[field],'readings':evidence}
   else:
    w[field]='';w.pop('ipaSource',None);w['ipaStatus']='pending';missing+=1
    audit['missing'].append({'bank':bank,'id':w.get('id'),'word':w['word']})
   if bank!='maps':clean_inline(w,db,audit,key)
  audit['counts'][bank]={'total':len(words),'verified':verified,'pending':missing}
 html=html[:m.start(2)]+json.dumps(core,ensure_ascii=False,separators=(',',':'))+html[m.end(2):];hp.write_text(html,'utf-8')
 fp.write_text(text[:fm.start(2)]+json.dumps(full,ensure_ascii=False,separators=(',',':'))+text[fm.end(2):],'utf-8')
 mp.write_text(mt[:mt.index('=')+1]+json.dumps(maps,ensure_ascii=False,separators=(',',':'))+';\n','utf-8')
 reports=root/'reports';reports.mkdir(exist_ok=True)
 (reports/'dictionary-ipa-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),'utf-8')
 print(json.dumps(audit['counts'],ensure_ascii=False));print('missing:', sorted({w['word'] for w in audit['missing']}))
if __name__=='__main__':main()
