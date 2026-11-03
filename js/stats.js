/*!
 * stats.js — 统计（F6）
 * ---------------------------------------------------------------------------
 * 四项顶部指标：本周完成数、本周新增任务数、整体完成率、当前连续天数；
 * 一个最近七天完成趋势条形图（纯 DOM，不引入图表库）。
 * 统计是只读视图：每次都从存储实时计算，不缓存、不写任何数据。
 * 依赖：storage.js、profile.js（连续天数）、goals.js（目标进度，可选）。
 */
(function (global) {
  'use strict';

  const LL = (global.LL = global.LL || {});
  const Store = LL.Storage;
  const Util = LL.Util;

  function dateOf(isoText) {
    if (!isoText) return null;
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return null;
    return Util.toDateStr(date);
  }

  /** 本周一 00:00 到本周日 23:59:59 的 [start, end] 日期字符串 */
  function weekBounds(now) {
    const today = now || new Date();
    const monday = Util.startOfWeek(today);
    const start = Util.toDateStr(monday);
    return { start: start, end: Util.addDays(start, 6), today: Util.toDateStr(today) };
  }

  /**
   * 汇总当前所有指标。纯函数式读取，可单独用于测试。
   * @returns {{weekDone:number, weekNew:number, rate:number|null, done:number,
   *            total:number, streak:number}}
   */
  function summary(now) {
    const tasks = Store.readTasks();
    const bounds = weekBounds(now);
    let weekDone = 0;
    let weekNew = 0;
    let done = 0;

    tasks.forEach((task) => {
      if (task.done) done += 1;
      const completedOn = dateOf(task.completedAt);
      if (completedOn && completedOn >= bounds.start && completedOn <= bounds.end) weekDone += 1;
      const createdOn = dateOf(task.createdAt);
      if (createdOn && createdOn >= bounds.start && createdOn <= bounds.end) weekNew += 1;
    });

    const total = tasks.length;
    return {
      weekDone: weekDone,
      weekNew: weekNew,
      rate: total === 0 ? null : Math.floor((done / total) * 100),
      done: done,
      total: total,
      streak: LL.Profile.currentStreak()
    };
  }

  /**
   * 最近七天（含今天）每天的完成任务数，按时间正序返回。
   * @returns {Array<{date:string, label:string, count:number, isToday:boolean}>}
   */
  function sevenDayTrend(now) {
    const today = now || new Date();
    const tasks = Store.readTasks();
    const counts = Object.create(null);
    tasks.forEach((task) => {
      const day = dateOf(task.completedAt);
      if (day) counts[day] = (counts[day] || 0) + 1;
    });

    const todayStr = Util.toDateStr(today);
    const result = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = Util.addDays(todayStr, -offset);
      result.push({
        date: day,
        label: Util.weekdayLabel(day),
        count: counts[day] || 0,
        isToday: day === todayStr
      });
    }
    return result;
  }

  function render() {
    const data = summary();
    const weekDoneEl = document.getElementById('stat-week-done');
    const weekNewEl = document.getElementById('stat-week-new');
    const rateEl = document.getElementById('stat-rate');
    const streakEl = document.getElementById('stat-streak');

    if (weekDoneEl) weekDoneEl.textContent = String(data.weekDone);
    if (weekNewEl) weekNewEl.textContent = String(data.weekNew);
    if (rateEl) {
      rateEl.textContent = data.rate === null ? '—' : data.rate + '%';
      rateEl.title =
        data.total === 0
          ? '还没有任务，完成率无从计算'
          : '共 ' + data.total + ' 个任务，已完成 ' + data.done + ' 个';
    }
    if (streakEl) streakEl.innerHTML = data.streak + ' <small>天</small>';

    renderTrend();
  }

  function renderTrend() {
    const host = document.getElementById('trend');
    if (!host) return;

    const days = sevenDayTrend();
    const max = days.reduce((acc, day) => Math.max(acc, day.count), 0);
    host.innerHTML = days
      .map((day) => {
        const ratio = max === 0 ? 0 : day.count / max;
        const height = Math.round(6 + ratio * 32);
        return (
          '<div class="trend-day' +
          (day.isToday ? ' is-today' : '') +
          '" title="' +
          day.date +
          '：完成 ' +
          day.count +
          ' 个任务">' +
          '<div class="trend-bar' +
          (day.count === 0 ? ' is-empty' : '') +
          '" style="height:' +
          height +
          'px"></div>' +
          '<span class="trend-label">' +
          day.label +
          '</span>' +
          '</div>'
        );
      })
      .join('');
    host.setAttribute('aria-label', '最近七天完成任务数：' + days.map((d) => d.label + d.count).join('、'));
  }

  LL.Stats = { summary, sevenDayTrend, weekBounds, render };
})(typeof window !== 'undefined' ? window : globalThis);
