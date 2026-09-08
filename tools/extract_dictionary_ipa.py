"""Extract only this site's headwords from a Kaikki/Wiktionary bulk dump.
No pronunciation synthesis: all IPA values are copied from English sounds records.
"""
import gzip,json,re,sys
from pathlib import Path
from urllib.parse import quote
ROOT=Path(__file__).resolve().parents[1]
ALIASES={
 'jewel(ie)ry':['jewellery','jewelry'], 'kilometre(-ter)':['kilometre','kilometer'],
 'neighbour(r)':['neighbour','neighbor'], 'neighbou(r)hood':['neighbourhood','neighborhood'],
 'fibre/-ber':['fibre','fiber'], 'civilisation/-zation':['civilisation','civilization'],
 'privatisation/-zation':['privatisation','privatization'],
 'specialisation/-zation':['specialisation','specialization'],
 'urbanisation/-zation':['urbanisation','urbanization'],
 'authorisation/-zation':['authorisation','authorization'],
 'utilisation/-zation':['utilisation','utilization'],
 'offence/-se':['offence','offense'], 'defence/-se':['defence','defense'],
 'analyse/-yze':['analyse','analyze'],
}
def variants(word):
 word=word.strip().replace('’',"'")
 if word in ALIASES:return ALIASES[word]
 parts=word.split('/')
 result=[]
 for part in parts:
  if part.startswith('-'):
   base=parts[0];tail=part[1:]
   if tail=='ize' and base.endswith('ise'):part=base[:-3]+tail
   elif tail=='izer' and base.endswith('iser'):part=base[:-4]+tail
   else:continue
  if '(' in part:
   result.extend([re.sub(r'\((.*?)\)',r'\1',part),re.sub(r'\(.*?\)','',part)])
  else:result.append(part)
 return list(dict.fromkeys(result))
def load_banks(root=ROOT):
 html=(root/'cet6_quiz.html').read_text('utf-8')
 core=json.loads(re.search(r'id="data-all-words">(.*?)</script>',html,re.S)[1])
 text=(root/'full-words.js').read_text('utf-8')
 full=json.loads(re.search(r'__FULL_WORDS_DATA__\s*=\s*(\[.*\])',text,re.S)[1])
 text=(root/'unit-maps.js').read_text('utf-8')
 maps=json.loads(text[text.index('=')+1:].strip().rstrip(';'))
 return core,full,maps

def nodes(obj):
 if isinstance(obj,dict):
  if isinstance(obj.get('word'),str):yield obj
  for v in obj.values():yield from nodes(v)
 elif isinstance(obj,list):
  for v in obj:yield from nodes(v)

def main():
 core,full,maps=load_banks()
 targets={v for w in core+full+list(nodes(maps)) for v in variants(w['word'])}
 out={};lines=0
 with gzip.open(sys.argv[1],'rt',encoding='utf-8') as f:
  for line in f:
   item=json.loads(line);word=item.get('word','');lines+=1
   if word not in targets:continue
   sounds=[{k:s[k] for k in ('ipa','tags','note') if k in s} for s in item.get('sounds',[]) if s.get('ipa')]
   if sounds:
    out.setdefault(word,[]).append({'pos':item.get('pos'),'sounds':sounds,
     'source':'https://en.wiktionary.org/wiki/'+quote(word,safe='')+'#English'})
 Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False,indent=2),'utf-8')
 print('dump records',lines,'targets',len(targets),'matched headwords',len(out),flush=True)
 missing=sorted(targets-set(out))
 print('missing',len(missing),missing,flush=True)
if __name__=='__main__':main()
