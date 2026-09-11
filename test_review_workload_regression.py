"""真实词库的复习量及旧打卡存档迁移回归测试。

25 天计划现在覆盖 Unit 1-14（照抄纸质打卡表），Unit 11-14 是按字母分组的基础词区，
所以第 11 天这类日子的单日题量会明显高于以前的 Unit 1-10 版本：
    第 11 天 = Unit 11(1230) + 5(78) + 8(214) + 10(233) = 1755 题
打卡队列只修剪「不属于 25 天计划」的题（没有单元编号的补充词），不再修剪 Unit 11-14。
"""
from pathlib import Path
import unittest
from playwright.sync_api import sync_playwright

ALL_WORDS_TOTAL = 6526
DAY11_UNITS = [11, 5, 8, 10]
DAY11_TOTAL = 1755          # 1230 + 78 + 214 + 233
DAY14_UNITS = [14, 3, 8, 11, 13]


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
        self.assertEqual(
            dict(all=ALL_WORDS_TOTAL, foundation=1230, units=DAY11_UNITS,
                 due=DAY11_TOTAL, unique=DAY11_TOTAL), result)

    def test_day14_pushes_every_unit_of_the_paper_table(self):
        """截图 bug：第14天曾只推出 Unit 2、8，漏掉 Unit 14、3、11、13。"""
        result = self.page.evaluate('''() => {
          state.ebbingPlan = {day:14, dayKey:dayKeyStr(new Date()), completedUnits:[]};
          const ids = dueUnitWordIds();
          return {units:dueUnitsByEbbing(), plan:ebbingPlanUnits(14),
            counts:[14,3,8,11,13].map(u=>ebbingUnitWords(u).length),
            len:ids.length, maxUnit:Math.max(...ids.map(id=>getWord(id,'core').unit))};
        }''')
        self.assertEqual(DAY14_UNITS, result["plan"])
        self.assertEqual(DAY14_UNITS, result["units"])
        self.assertEqual([1518, 164, 214, 1230, 494], result["counts"])
        self.assertEqual(sum(result["counts"]), result["len"])
        self.assertEqual(14, result["maxUnit"])

    def test_today_answers_deducted(self):
        result = self.page.evaluate('''() => {
          const ids = dueUnitWordIds();
          ids.slice(0,3).forEach(id => state.stats.wordAttempts[wordStateKey(id,'core')] =
            {attempts:1,lastTime:Date.now()});
          return dueUnitWordIds().length;
        }''')
        self.assertEqual(DAY11_TOTAL - 3, result)

    def test_snapshot_trims_words_outside_the_plan(self):
        result = self.page.evaluate('''() => {
          const outside=ALL_WORDS.find(w=>!w.unit).id, a=ebbingUnitWords(5)[0].id, b=ebbingUnitWords(8)[0].id;
          const sq={isEbbingPlan:true,poolType:'core',ids:[outside,a,b],pos:1,currentId:a,
            answers:{0:1,1:2},done:2,reviewCorrect:2,
            questionSnapshots:[{wordId:outside,correctIndex:1},{wordId:a,correctIndex:2},null]};
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

    def test_unit_11_to_14_snapshots_are_kept(self):
        """Unit 11-14 现在是计划内的正式单元，打卡存档不得再被修剪。"""
        result = self.page.evaluate('''() => {
          const ids=[11,12,13,14].map(u=>ebbingUnitWords(u)[0].id);
          const sq={isEbbingPlan:true,poolType:'core',ids:ids.slice(),pos:0,answers:{}};
          state.suspendedQuiz=sq;
          const changed=migrateEbbingPlanSnapshot(sq);
          return {changed:changed,ids:sq.ids,kept:state.suspendedQuiz===sq};
        }''')
        self.assertFalse(result['changed'])
        self.assertEqual(4, len(result['ids']))
        self.assertTrue(result['kept'])

    def test_out_of_plan_only_snapshot_removed_not_stats(self):
        result = self.page.evaluate('''() => {
          const id=ALL_WORDS.find(w=>!w.unit).id, key=wordStateKey(id,'core');
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

    def test_completed_day_rolls_over_to_the_next_plan(self):
        result = self.page.evaluate('''() => {
          const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
          state.ebbingPlan={day:24,dayKey:dayKeyStr(yesterday),completedUnits:[]};
          state.stats.wordAttempts={};
          // 第24天计划 Unit 13，昨天已全部答过
          ebbingUnitWords(13).forEach(w => state.stats.wordAttempts[wordStateKey(w.id,'core')] =
            {attempts:1,lastTime:Date.now()-86400000+3600000});
          syncEbbingPlan(); renderEbbingPlan();
          return {day:state.ebbingPlan.day,makeup:state.ebbingPlan.makeup,
            due:dueUnitsByEbbing(),text:document.getElementById('ebbingPlan').textContent};
        }''')
        self.assertEqual(25, result['day'])
        self.assertFalse(result['makeup'])
        self.assertEqual([14], result['due'])
        self.assertIn('第 25 天', result['text'])
        self.assertNotIn('重做第', result['text'])

    def test_missed_day_clears_progress_and_forces_redo(self):
        result = self.page.evaluate('''() => {
          const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
          state.ebbingPlan={day:24,dayKey:dayKeyStr(yesterday),completedUnits:[]};
          state.stats.wordAttempts={};
          // 昨天只答了 Unit 13 的一半
          ebbingUnitWords(13).slice(0,10).forEach(w => state.stats.wordAttempts[wordStateKey(w.id,'core')] =
            {attempts:1,lastTime:Date.now()-86400000+3600000});
          syncEbbingPlan(); renderEbbingPlan();
          return {day:state.ebbingPlan.day,makeup:state.ebbingPlan.makeup,
            completed:state.ebbingPlan.completedUnits.slice(),
            due:dueUnitsByEbbing(),text:document.getElementById('ebbingPlan').textContent};
        }''')
        self.assertEqual(24, result['day'], '未完成则停留在原计划日')
        self.assertTrue(result['makeup'])
        self.assertEqual([], result['completed'], '前一天的进度必须清空')
        self.assertEqual([13], result['due'], '整天重做，昨天答过的词也要重来')
        self.assertIn('重做第 24 天计划', result['text'])

    def test_legacy_real_queue_reload_resume_and_modal(self):
        self.page.evaluate('''() => {
          startReview();
          const outside=ALL_WORDS.filter(w=>!w.unit).slice(0,3).map(w=>w.id);
          const sq=suspendedQuizSnapshot(quizState);
          sq.ids=outside.concat(sq.ids); sq.pos=outside.length;
          sq.answers={}; sq.answers[outside.length]=0; sq.done=1;
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
        self.assertEqual(DAY11_TOTAL, result['len'])
        self.assertEqual(1, result['done'])
        self.assertEqual(0, result['pos'])
        self.assertEqual(11, result['maxUnit'])
        self.assertIn(str(DAY11_TOTAL - 1), result['text'])
        self.assertNotIn('525', result['text'])

    def test_memory_cumulative_progress_preserved(self):
        result = self.page.evaluate("""() => {
          const sq={isEbbingPlan:true,isMemory:true,poolType:'core',
            ids:[ebbingUnitWords(11)[0].id,ebbingUnitWords(5)[0].id],
            answers:{},done:7,memTotal:9,memoryResults:['correct','wrong'],pos:0};
          migrateEbbingPlanSnapshot(sq);
          return {done:sq.done,total:sq.memTotal,results:sq.memoryResults,len:sq.ids.length};
        }""")
        self.assertEqual({'done':7,'total':9,'results':['correct','wrong'],'len':2},result)

    def test_new_reminder_breakdown(self):
        text=self.page.evaluate('''() => {
          checkSpacedRepetition(); return document.getElementById('reviewReminderModal').textContent;
        }''')
        for fragment in ['Unit 11：待完成 1230','Unit 5：待完成 78','Unit 8：待完成 214',
                         'Unit 10：待完成 233','合计待完成 1755']:
            self.assertIn(fragment,text)

if __name__=='__main__':
    unittest.main(verbosity=2)
