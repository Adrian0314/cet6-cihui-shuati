const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'cet6_quiz.html'), 'utf8');
const m = html.match(/<script type="application\/json" id="data-all-words">([\s\S]*?)<\/script>/);
const arr = JSON.parse(m[1]);
const words = ["their","theirs","hear","hair","manoeuvre","annual","thesis","heir","eminent","access","manuscript","manifest","ambition","accession"];
for (const w of words) {
  const it = arr.find(x => x.word === w);
  if (it) console.log(`${w}: meaning=${JSON.stringify(it.meaning)} || pron=${JSON.stringify(it.pronunciation)}`);
  else console.log(`${w}: (NOT FOUND in core pool)`);
}
