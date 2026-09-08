"""Build a small pronunciation/alternative-spelling cache from downloaded Kaikki dumps."""
import gzip,json,sys
from pathlib import Path
from extract_dictionary_ipa import load_banks,nodes,variants
folder=Path(sys.argv[1]); core,full,maps=load_banks()
targets={v for w in core+full+list(nodes(maps)) for v in variants(w['word'])}
targets.update(v.lower() for v in list(targets));targets.update(['volt','disappointing'])
entries=json.loads((folder/'entries.json').read_text('utf-8'))
aliases={}
for word,records in entries.items():
 for r in records:
  for s in r.get('senses',[]):
   if any('spelling' in g.lower() or 'capitalization' in g.lower() for g in s.get('glosses',[])):
    for a in s.get('alt_of',[]):
     if a.get('word'): aliases.setdefault(word,[]).append(a['word']);targets.add(a['word'])
del entries
out={}
files=[('en','english.jsonl.gz'),('fr','fr-Anglais.jsonl'),('zh','zh-英語.jsonl'),('zh','zh-英语.jsonl'),('de','de.jsonl'),('ru','ru.jsonl')]
for ed,name in files:
 path=folder/name
 if not path.exists():continue
 opener=gzip.open if name.endswith('.gz') else open
 count=0
 with opener(path,'rt',encoding='utf-8') as f:
  for line in f:
   r=json.loads(line);w=r.get('word')
   if w not in targets or r.get('lang_code','en')!='en':continue
   sounds=[{k:s[k] for k in ('ipa','tags','raw_tags','note') if k in s} for s in r.get('sounds',[]) if s.get('ipa')]
   if sounds:out.setdefault(w,[]).append({'edition':ed,'pos':r.get('pos'),'sounds':sounds});count+=1
 print(ed,count,flush=True)
(folder/'prepared.json').write_text(json.dumps({'entries':out,'aliases':aliases},ensure_ascii=False),'utf-8')
