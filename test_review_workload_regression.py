"""真实词库的复习量及旧打卡存档迁移回归测试。"""
from pathlib import Path
import unittest
from playwright.sync_api import sync_playwright

class ReviewWorkloadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={"width": 390, "height": 844})
        self.page.goto(Path(__file__).with_name('cet6_quiz.html').as_uri())
        self.page.evaluate('''() => {
            state.ebbingActive = true;
            state.ebbingStart = dayKeyStr(new Date());
            state.ebbingPlan = {day:11, dayKey:dayKeyStr(new Date()), completedUnits:[]};
            state.stats.wordAttempts = {};
            currentPool = 'core'; state.prefs.pool = 'core';
            state.suspendedQuiz = null;
        }''')

    def tearDown(self):
        self.page.close()

    def test_real_day11_counts_and_no_word_deletion(self):
        result = self.page.evaluate('''() => ({all:ALL_WORDS.length,
          foundation:ebbingUnitWords(11).length, units:dueUnitsByEbbing(),
          due:dueUnitWordIds().length, unique:new Set(dueUnitWordIds()).size})''')
        self.assertEqual(dict(all=6526, foundation=1230, units=[5,8,10], due=525, unique=525), result)

    def test_today_answers_deducted(self):
        result = self.page.evaluate('''() => {
          const ids = dueUnitWordIds();
          ids.slice(0,3).forEach(id => state.stats.wordAttempts[wordStateKey(id,'core')] =
            {attempts:1,lastTime:Date.now()});
          return dueUnitWordIds().length;
        }''')
        self.assertEqual(522, result)

    def test_migrate_answers_snapshots_and_position(self):
        result = self.page.evaluate('''() => {
          const f=ebbingUnitWords(11)[0].id, a=ebbingUnitWords(5)[0].id, b=ebbingUnitWords(8)[0].id;
          const sq={isEbbingPlan:true,poolType:'core',ids:[f,a,b],pos:1,currentId:a,
            answers:{0:1,1:2},done:2,reviewCorrect:2,
            questionSnapshots:[{wordId:f,correctIndex:1},{wordId:a,correctIndex:2},null]};
          state.suspendedQuiz=sq; migrateEbbingPlanSnapshot(sq);
          return {ids:sq.ids,expected:[a,b],answers:sq.answers,pos:sq.pos,current:sq.currentId,
            done:sq.done,correct:sq.reviewCorrect,remaining:sq.ebbingPlanRemaining,
            first:sq.questionSnapshots[0].wordId,again:migrateEbbingPlanSnapshot(sq)};
        }''')
        self.assertEqual(result['expected'], result['ids'])
        self.assertEqual({'0':2}, result['answers'])
        self.assertEqual(0, result['pos'])
        self.assertEqual(result['ids'][0], result['first'])
        self.assertEqual(result['ids'][0], result['current'])
        self.assertEqual(1, result['done'])
        self.assertEqual(1, result['correct'])
        self.assertEqual({'8':1}, result['remaining'])
        self.assertFalse(result['again'])

    def test_foundation_only_snapshot_removed_not_stats(self):
        result = self.page.evaluate('''() => {
          const id=ebbingUnitWords(14)[0].id, key=wordStateKey(id,'core');
          state.stats.wordAttempts[key]={attempts:5,lastTime:Date.now()};
          state.suspendedQuiz={isEbbingPlan:true,poolType:'core',ids:[id],answers:{},pos:0};
          checkSuspendedQuiz();
          return {sq:state.suspendedQuiz,attempts:state.stats.wordAttempts[key].attempts};
        }''')
        self.assertEqual({'sq':None,'attempts':5}, result)

    def test_ordinary_and_full_snapshots_unchanged(self):
        self.assertTrue(self.page.evaluate('''() => [
          {isEbbingPlan:false,poolType:'core'}, {isEbbingPlan:true,poolType:'full'}
        ].every(flags => {
          const sq=Object.assign({ids:[ebbingUnitWords(11)[0].id],pos:0,answers:{0:1}},flags);
          const before=JSON.stringify(sq); migrateEbbingPlanSnapshot(sq);
          return before===JSON.stringify(sq);
        })'''))

    def test_empty_days_complete_and_roll_over(self):
        result = self.page.evaluate('''() => {
          const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
          state.ebbingPlan={day:23,dayKey:dayKeyStr(yesterday),completedUnits:[]};
          syncEbbingPlan(); renderEbbingPlan();
          return {day:state.ebbingPlan.day,complete:isEbbingPlanComplete(state.ebbingPlan),
            due:dueUnitWordIds(),text:document.getElementById('ebbingPlan').textContent};
        }''')
        self.assertEqual(24, result['day'])
        self.assertTrue(result['complete'])
        self.assertEqual([], result['due'])
        self.assertIn('无自动任务', result['text'])

    def test_legacy_real_queue_reload_resume_and_modal(self):
        self.page.evaluate('''() => {
          startReview();
          const foundation=ebbingUnitWords(11).map(w=>w.id);
          const sq=suspendedQuizSnapshot(quizState);
          sq.ids=foundation.concat(sq.ids); sq.pos=foundation.length;
          sq.answers={}; sq.answers[foundation.length]=0; sq.done=1;
          sq.questionSnapshots=[]; state.suspendedQuiz=sq; quizActive=false; saveState();
        }''')
        self.page.reload()
        result=self.page.evaluate('''() => {
          const modal=document.getElementById('reviewReminderModal'); if(modal) modal.remove();
          checkSpacedRepetition();
          const text=document.getElementById('reviewReminderModal').textContent;
          startReview();
          return {text,len:quizState.ids.length,done:quizState.done,pos:quizState.pos,
            maxUnit:Math.max(...quizState.ids.map(id=>getWord(id,'core').unit))};
        }''')
        self.assertEqual(525,result['len'])
        self.assertEqual(1,result['done'])
        self.assertEqual(0,result['pos'])
        self.assertLessEqual(result['maxUnit'],10)
        self.assertIn('524', result['text'])
        self.assertNotIn('1755',result['text'])

    def test_memory_cumulative_progress_preserved(self):
        result = self.page.evaluate("""() => {
          const sq={isEbbingPlan:true,isMemory:true,poolType:'core',
            ids:[ebbingUnitWords(11)[0].id,ebbingUnitWords(5)[0].id],
            answers:{},done:7,memTotal:9,memoryResults:['correct','wrong'],pos:0};
          migrateEbbingPlanSnapshot(sq);
          return {done:sq.done,total:sq.memTotal,results:sq.memoryResults,len:sq.ids.length};
        }""")
        self.assertEqual({'done':7,'total':8,'results':['correct','wrong'],'len':1},result)

    def test_new_reminder_breakdown(self):
        text=self.page.evaluate('''() => {
          checkSpacedRepetition(); return document.getElementById('reviewReminderModal').textContent;
        }''')
        for fragment in ['Unit 5：待完成 78','Unit 8：待完成 214','Unit 10：待完成 233','合计待完成 525']:
            self.assertIn(fragment,text)

if __name__=='__main__':
    unittest.main(verbosity=2)
