/*!
 * tests/logic-test.js — 数据层与核心业务规则的自动化自测
 * ---------------------------------------------------------------------------
 * 运行方式（不需要安装任何依赖）：
 *     node tests/logic-test.js
 *
 * 为什么用 Node 跑：本项目零构建、零依赖，界面靠浏览器手工验收（见
 * tests/manual-checklist.md）。但进度计算、经验发放、幂等、导入校验这些
 * 规则用脚本验证更快、更可靠，所以这里用最小的浏览器替身直接加载 js/ 下的
 * 经典脚本。app.js 依赖真实 DOM，不在本测试范围内。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ------------------------- 最小浏览器替身 ------------------------- */
function createLocalStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
    clear() {
      map.clear();
    }
  };
}

global.window = global;
global.localStorage = createLocalStorage();
global.document = {
  readyState: 'complete',
  getElementById() {
    return null;
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  createElement() {
    return { classList: { add() {}, remove() {} }, appendChild() {}, remove() {} };
  },
  addEventListener() {},
  body: { classList: { add() {}, remove() {}, toggle() {} } }
};
global.navigator = {};
global.location = { protocol: 'file:' };

/* ------------------------- 加载被测模块 ------------------------- */
const JS_DIR = path.join(__dirname, '..', 'js');
['storage.js', 'profile.js', 'goals.js', 'tasks.js', 'stats.js'].forEach((name) => {
  // 用 require 触发执行，模块内部是 IIFE，挂到 global.LL 上
  require(path.join(JS_DIR, name));
});

const LL = global.LL;
const Store = LL.Storage;
const Util = LL.Util;
const Profile = LL.Profile;
const Goals = LL.Goals;
const Tasks = LL.Tasks;
const Stats = LL.Stats;

/* ------------------------- 迷你断言 ------------------------- */
let passed = 0;
const failures = [];

function check(label, condition, actual) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(label + (actual === undefined ? '' : '（实际：' + JSON.stringify(actual) + '）'));
}

function equal(label, actual, expected) {
  check(label, actual === expected, actual);
}

function reset() {
  global.localStorage.clear();
  Store.init();
  toasts.length = 0;
}

/* Toast 替身：把文案收集起来，便于断言精确文案 */
const toasts = [];
LL.ui = {
  toast(message, options) {
    toasts.push({ message, options: options || {} });
  },
  confirm() {
    return Promise.resolve(true);
  }
};

function lastToast() {
  return toasts.length ? toasts[toasts.length - 1].message : '';
}

async function run() {
  /* ========== 1. 经验与等级公式 ========== */
  equal('升级所需经验：L1→L2 = 100', Profile.stepFor(1), 100);
  equal('升级所需经验：L2→L3 = 150', Profile.stepFor(2), 150);
  equal('累计经验：L3 = 250', Profile.totalFor(3), 250);
  equal('累计经验：L5 = 700', Profile.totalFor(5), 700);
  equal('经验 0 → L1', Profile.levelFromExp(0), 1);
  equal('经验 99 → L1', Profile.levelFromExp(99), 1);
  equal('经验 100 → L2', Profile.levelFromExp(100), 2);
  equal('经验 700 → L5', Profile.levelFromExp(700), 5);
  equal('称号：L1', Profile.titleFor(1), '起步者');
  equal('称号：L3', Profile.titleFor(3), '坚持者');
  equal('称号：超过 5 级沿用掌控者', Profile.titleFor(9), '掌控者');
  equal('升级文案', Profile.levelUpMessage(3), '升到 3 级了：坚持者。');

  equal('任务经验：15 分钟', Profile.taskExp(15), 10);
  equal('任务经验：30 分钟', Profile.taskExp(30), 10);
  equal('任务经验：60 分钟', Profile.taskExp(60), 20);
  equal('任务经验：90 分钟', Profile.taskExp(90), 30);
  equal('任务经验：120 分钟', Profile.taskExp(120), 30);
  equal('任务经验：未填写按中任务', Profile.taskExp(null), 20);

  /* ========== 2. 经验发放：只加不减、去重 ========== */
  reset();
  const first = Profile.addExp(120, 'task', 't_demo');
  check('首次发经验成功', first.awarded === true);
  equal('发经验后经验值', Store.readProfile().exp, 120);
  equal('发经验后等级', Profile.get().level, 2);
  const second = Profile.addExp(120, 'task', 't_demo');
  equal('同 (source, refId) 不重复发放', second.awarded, false);
  equal('重复发放不改变经验', Store.readProfile().exp, 120);
  const jump = Profile.addExp(300, 'test', 'jump');
  check('支持一次跨多级', jump.leveledUp === true);
  equal('跨级后等级', jump.after, Profile.levelFromExp(Store.readProfile().exp));

  reset();
  Profile.addExp(0, 'task', 'zero');
  equal('0 经验不记账', Store.readProfile().expLog.length, 0);

  /* ========== 3. 目标：新建、重名、置顶 ========== */
  reset();
  const g1 = Goals.create({ title: '通过英语六级', color: 'green', due: '2026-12-20' });
  check('新建目标成功', g1.ok === true);
  equal('目标默认状态', g1.goal.status, 'active');
  equal('目标颜色写入', g1.goal.color, 'green');

  const g2 = Goals.create({ title: '读完 12 本书' });
  equal('新目标排在列表最前', Goals.list()[0].id, g2.goal.id);

  const g3 = Goals.create({ title: '通过英语六级' });
  check('重名仍然保存', g3.ok === true && g3.duplicated === true);
  check('重名给出提示', lastToast().indexOf('已有同名目标') >= 0, lastToast());

  const empty = Goals.create({ title: '   ' });
  equal('空标题被拒绝', empty.ok, false);

  /* ========== 4. F3 进度与三档颜色 ========== */
  reset();
  const g = Goals.create({ title: '进度测试' }).goal;
  equal('无任务时标记为空', Goals.progress(g.id).isEmpty, true);
  equal('无任务时文案', Goals.progress(g.id).label, '尚未拆解');

  const makeTask = (title, estimate) =>
    Tasks.create({ title, goalId: g.id, priority: 'medium', estimate }).task;

  const t1 = makeTask('任务一', 15);
  makeTask('任务二', 30);
  makeTask('任务三', 60);
  let progress = Goals.progress(g.id);
  equal('0/3 进度 0%', progress.percent, 0);
  equal('0/3 颜色 low', progress.tone, 'low');

  Tasks.toggle(t1.id);
  progress = Goals.progress(g.id);
  equal('1/3 向下取整 33%', progress.percent, 33);
  equal('33% 颜色 mid', progress.tone, 'mid');

  const rest = Goals.tasksOf(g.id).filter((task) => task.id !== t1.id);
  rest.forEach((task) => Tasks.toggle(task.id));
  progress = Goals.progress(g.id);
  equal('3/3 进度 100%', progress.percent, 100);
  equal('100% 颜色 full', progress.tone, 'full');

  reset();
  const gLow = Goals.create({ title: '低进度' }).goal;
  const five = [];
  for (let i = 0; i < 5; i += 1) five.push(makeTaskFor(gLow.id, '任务' + i));
  Tasks.toggle(five[0].id);
  equal('1/5 进度 20%', Goals.progress(gLow.id).percent, 20);
  equal('20% 颜色 low', Goals.progress(gLow.id).tone, 'low');

  function makeTaskFor(goalId, title) {
    return Tasks.create({ title, goalId }).task;
  }

  /* ========== 5. 任务：排序、完成发经验、撤销不回收、幂等 ========== */
  reset();
  const gt = Goals.create({ title: '任务规则' }).goal;
  const high = Tasks.create({ title: '高优先级', goalId: gt.id, priority: 'high', estimate: 30 }).task;
  const low = Tasks.create({ title: '低优先级', goalId: gt.id, priority: 'low', estimate: 60 }).task;
  const mid = Tasks.create({ title: '中优先级', goalId: gt.id, priority: 'medium', estimate: 90 }).task;
  Tasks.create({ title: '无截止', goalId: gt.id, priority: 'medium' });

  const order = Tasks.listOf(gt.id).map((task) => task.title);
  equal('高优先级排在最前', order[0], '高优先级');
  check('低优先级不会排在中优先级之前', order.indexOf('中优先级') < order.indexOf('低优先级'), order);

  Tasks.toggle(high.id);
  equal('完成小任务 +10 经验', Store.readProfile().exp, 10);
  equal('完成时间被记录', typeof Tasks.get(high.id).completedAt, 'string');

  const sortedDone = Tasks.listOf(gt.id).map((task) => task.title);
  equal('已完成沉底', sortedDone[sortedDone.length - 1], '高优先级');

  Tasks.toggle(high.id);
  equal('撤销完成清空 completedAt', Tasks.get(high.id).completedAt, null);
  equal('撤销完成不回收经验', Store.readProfile().exp, 10);

  Tasks.toggle(high.id);
  equal('再次完成不重复发经验', Store.readProfile().exp, 10);
  check('再次完成仍提示已完成', lastToast().indexOf('任务完成') >= 0, lastToast());

  equal('已完成任务计经验来源', Store.readProfile().expLog[0].source, 'task');
  equal('经验记录关联任务 id', Store.readProfile().expLog[0].refId, high.id);

  const noGoal = Tasks.create({ title: '孤儿任务', goalId: 'g_missing' });
  equal('任务必须归属于存在的目标', noGoal.ok, false);

  equal('中任务 90 分钟经验档', Profile.taskExp(mid.estimate), 30);

  /* ========== 6. 目标完成：+50 且只发一次 ========== */
  reset();
  const gd = Goals.create({ title: '完成目标' }).goal;
  Goals.setStatus(gd.id, 'done');
  equal('完成目标 +50 经验', Store.readProfile().exp, 50);
  Goals.setStatus(gd.id, 'active');
  equal('重新打开不回收经验', Store.readProfile().exp, 50);
  Goals.setStatus(gd.id, 'done');
  equal('再次完成不重复发经验', Store.readProfile().exp, 50);

  /* ========== 7. 打卡与连续天数 ========== */
  reset();
  const today = Util.todayStr();
  const yesterday = Util.addDays(today, -1);

  Store.writeCheckins({ [yesterday]: true });
  const c = Profile.checkin();
  check('打卡成功', c.ok === true);
  equal('连续天数 = 2', c.streak, 2);
  equal('打卡 +5 经验', c.exp, 5);
  equal('打卡不触发连签奖励', c.bonus, 0);

  const again = Profile.checkin();
  equal('当天重复打卡被拒绝', again.ok, false);
  equal('重复打卡原因', again.reason, 'already');

  reset();
  const six = [];
  for (let i = 6; i >= 1; i -= 1) six.push(Util.addDays(today, -i));
  const map = {};
  six.forEach((day) => {
    map[day] = true;
  });
  Store.writeCheckins(map);
  const seventh = Profile.checkin();
  equal('连续第七天', seventh.streak, 7);
  equal('连签奖励 +20', seventh.bonus, 20);
  equal('第七天总计 +25 经验', Store.readProfile().exp, 25);
  equal('连签奖励记录来源', Store.readProfile().expLog.some((e) => e.source === 'streak'), true);
  equal('里程碑数量记入 profile', Store.readProfile().streakBonusCount, 1);

  /* ========== 8. 级联删除 ========== */
  reset();
  const gc = Goals.create({ title: '级联删除' }).goal;
  Tasks.create({ title: '子任务一', goalId: gc.id });
  Tasks.create({ title: '子任务二', goalId: gc.id });
  const removed = await Goals.remove(gc.id);
  check('确认后删除目标', removed.ok === true);
  equal('级联删除任务数', removed.removedTasks, 2);
  equal('任务被一并删除', Store.readTasks().length, 0);
  equal('目标被删除', Store.readGoals().length, 0);

  reset();
  const ga = Goals.create({ title: '先归档再删' }).goal;
  Goals.setStatus(ga.id, 'archived');
  const purgeBad = await Goals.remove(ga.id, { purge: true });
  check('已归档目标允许彻底删除', purgeBad.ok === true);

  reset();
  const ga2 = Goals.create({ title: '未归档目标' }).goal;
  const purgeRejected = await Goals.remove(ga2.id, { purge: true });
  equal('未归档目标不能彻底删除', purgeRejected.ok, false);
  equal('提示先归档', purgeRejected.message, '请先把目标归档，再进行彻底删除。');

  /* ========== 9. 导出与导入校验 ========== */
  reset();
  const ge = Goals.create({ title: '导出目标' }).goal;
  Tasks.create({ title: '导出任务', goalId: ge.id, estimate: 60 });
  const backup = Store.buildExport();
  equal('导出包含版本号', backup.version, 1);
  equal('导出包含 schemaVersion', backup.schemaVersion, 1);
  check('导出包含导出时间', typeof backup.exportedAt === 'string');
  equal('导出目标数', backup.goals.length, 1);
  equal('导出任务数', backup.tasks.length, 1);
  check('导出包含 profile', Boolean(backup.profile));
  check('导出文件名格式', /^lifelite-backup-\d{8}\.json$/.test(Store.exportFileName()), Store.exportFileName());

  const text = Store.exportText();
  const parsed = Store.importText(text);
  check('自己导出的文件能导入', parsed.ok === true);
  equal('导入目标数', parsed.counts.goals, 1);

  equal('非法 JSON 被拒绝', Store.importText('{oops').ok, false);
  equal('非法 JSON 使用统一失败文案', Store.importText('{oops').message, '文件格式不对，需要 LifeLite 导出的备份文件。');
  equal('缺少 version 被拒绝', Store.importText(JSON.stringify({ goals: [], tasks: [] })).ok, false);
  equal(
    '版本号高于支持版本被拒绝',
    Store.importText(JSON.stringify({ version: 99, goals: [], tasks: [] })).ok,
    false
  );
  equal(
    'goals 不是数组被拒绝',
    Store.importText(JSON.stringify({ version: 1, goals: {}, tasks: [] })).ok,
    false
  );
  const badTask = Store.importText(
    JSON.stringify({
      version: 1,
      goals: [{ id: 'g_1', title: '目标' }],
      tasks: [{ id: 't_1', goalId: 'g_1' }]
    })
  );
  equal('单条任务缺字段整体拒绝', badTask.ok, false);
  check('单条校验给出具体原因', badTask.reason.indexOf('缺少标题') >= 0, badTask.reason);

  const applyOk = Store.applyImport(parsed);
  check('导入可写入存储', applyOk === true);
  equal('导入后目标数', Store.readGoals().length, 1);
  check('导入前保存了备用键', Store.read('backup') !== null);

  /* ========== 10. 统计口径 ========== */
  reset();
  const gs = Goals.create({ title: '统计' }).goal;
  const s1 = Tasks.create({ title: '本周完成', goalId: gs.id }).task;
  Tasks.create({ title: '本周新增未完成', goalId: gs.id });
  Tasks.toggle(s1.id);

  const summary = Stats.summary();
  equal('本周完成数', summary.weekDone, 1);
  equal('本周新增数', summary.weekNew, 2);
  equal('整体完成率', summary.rate, 50);
  equal('任务总数', summary.total, 2);

  const trend = Stats.sevenDayTrend();
  equal('趋势固定七天', trend.length, 7);
  equal('趋势最后一天是今天', trend[6].isToday, true);
  equal('今天完成数为 1', trend[6].count, 1);

  const bounds = Stats.weekBounds();
  check('本周起点是周一', new Date(bounds.start + 'T00:00:00').getDay() === 1, bounds.start);

  reset();
  equal('无任务时完成率为 null', Stats.summary().rate, null);

  /* ========== 11. 工具函数的边界 ========== */
  equal('日期字符串往返', Util.toDateStr(Util.parseDay('2026-01-05')), '2026-01-05');
  equal('加一天跨月', Util.addDays('2026-01-31', 1), '2026-02-01');
  equal('跨年减一天', Util.addDays('2026-01-01', -1), '2025-12-31');
  equal('HTML 转义', Util.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  equal('文本截断', Util.clip('  abcdef  ', 3), 'abc');
  equal('天数有效性', Util.isPastDay('2000-01-01'), true);

  /* ========== 12. 报告 ========== */
  console.log('');
  console.log('通过 ' + passed + ' 项断言。');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项：');
    failures.forEach((item) => console.log('  ✗ ' + item));
    process.exitCode = 1;
    return;
  }
  console.log('全部通过 ✓');
}

run().catch((err) => {
  console.error('测试脚本异常：', err);
  process.exitCode = 1;
});
