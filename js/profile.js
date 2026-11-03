/*!
 * profile.js — 经验值、等级、每日打卡、连续天数、打卡热力图
 * ---------------------------------------------------------------------------
 * 设计约束（方案 6.3）：
 *   · 只加不减：未完成任务不扣经验，断签不清空历史；
 *   · 经验只由数据层发放，界面不直接改数字；
 *   · 每次发放写一条经验记录（source + refId），可追溯、可去重；
 *   · 等级由累计经验推导，只增不降，不允许单独编辑。
 * 依赖：storage.js（LL.Storage / LL.Util / LL.CONST）。
 */
(function (global) {
  'use strict';

  const LL = (global.LL = global.LL || {});
  const Store = LL.Storage;
  const CONST = LL.CONST;
  const Util = LL.Util;

  /* ------------------------- 数值规则（方案第六章） ------------------------- */
  const CHECKIN_EXP = 5; // 每日打卡
  const STREAK_BONUS_EXP = 20; // 连续打卡每满 7 天
  const STREAK_BONUS_EVERY = 7;
  const GOAL_DONE_EXP = 50; // 完成一个目标
  const TITLES = ['起步者', '学习者', '坚持者', '自律者', '掌控者'];

  /** 从 n 级升到 n+1 级所需经验：100 + (n−1) × 50 */
  function stepFor(level) {
    return 100 + (level - 1) * 50;
  }

  /** 达到某等级所需的累计经验 */
  function totalFor(level) {
    let total = 0;
    for (let n = 1; n < level; n += 1) total += stepFor(n);
    return total;
  }

  /** 由累计经验反推等级，支持一次跨多级 */
  function levelFromExp(exp) {
    let level = 1;
    let safeExp = Math.max(0, Number(exp) || 0);
    while (safeExp >= totalFor(level + 1) && level < 999) level += 1;
    return level;
  }

  /** 等级称号；超过 5 级继续沿用「掌控者」，见 docs/design-decisions.md */
  function titleFor(level) {
    const index = Math.min(Math.max(level, 1), TITLES.length) - 1;
    return TITLES[index];
  }

  /** 任务经验档位：15–30 → 10，60 → 20，90–120 → 30，未填写按 20 计 */
  function taskExp(estimate) {
    const minutes = Number(estimate);
    if (!minutes) return 20;
    if (minutes <= 30) return 10;
    if (minutes < 90) return 20;
    return 30;
  }

  /* ------------------------- 档案读写 ------------------------- */
  /** 读取档案，并保证 level 与 exp 一致（等级只推导，不单独存真值） */
  function get() {
    const profile = Store.readProfile();
    profile.level = levelFromExp(profile.exp);
    return profile;
  }

  /**
   * 发放经验。同一 (source, refId) 只发一次，这是「连点不重复加经验」的兜底。
   * @returns {{awarded:boolean, amount?:number, before?:number, after?:number,
   *            leveledUp?:boolean, reason?:string}}
   */
  function addExp(amount, source, refId) {
    const gain = Math.round(Number(amount) || 0);
    if (gain <= 0) return { awarded: false, reason: 'zero' };

    const profile = Store.readProfile();
    const key = refId == null ? null : String(refId);
    const duplicated =
      key !== null &&
      profile.expLog.some((entry) => entry.source === source && entry.refId === key);
    if (duplicated) return { awarded: false, reason: 'duplicate' };

    const before = levelFromExp(profile.exp);
    profile.exp += gain;
    const after = levelFromExp(profile.exp);
    profile.level = after;
    profile.expLog.push({
      at: Util.nowISO(),
      amount: gain,
      source: source,
      refId: key
    });
    if (profile.expLog.length > CONST.MAX_EXP_LOG) {
      profile.expLog = profile.expLog.slice(-CONST.MAX_EXP_LOG);
    }
    Store.writeProfile(profile);
    return { awarded: true, amount: gain, before: before, after: after, leveledUp: after > before };
  }

  /** 完成任务：经验由任务 id 去重，撤销完成不回收 */
  function awardTask(task) {
    if (!task) return { awarded: false, reason: 'no-task' };
    return addExp(taskExp(task.estimate), 'task', task.id);
  }

  /** 完成目标：+50，同一目标只发一次 */
  function awardGoal(goalId) {
    if (!goalId) return { awarded: false, reason: 'no-goal' };
    return addExp(GOAL_DONE_EXP, 'goal', goalId);
  }

  /* ------------------------- 连续天数 ------------------------- */
  /**
   * 连续打卡天数：从今天（今天未打卡则从昨天）向前数连续记录。
   * 只读计算，不依赖存储里的 streak，避免跨日显示过期。
   */
  function currentStreak(checkins, today) {
    const map = checkins || Store.readCheckins();
    const base = today || Util.todayStr();
    let cursor = map[base] ? base : Util.addDays(base, -1);
    let count = 0;
    while (map[cursor] && count < 4000) {
      count += 1;
      cursor = Util.addDays(cursor, -1);
    }
    return count;
  }

  function todayCheckedIn() {
    const checkins = Store.readCheckins();
    return Boolean(checkins[Util.todayStr()]);
  }

  /**
   * 打卡：每天一次，重复点击只提示不重复计经验。
   * @returns {{ok:boolean, reason?:string, streak:number, exp?:number, bonus?:number,
   *            leveledUp?:boolean}}
   */
  function checkin() {
    const today = Util.todayStr();
    const checkins = Store.readCheckins();

    if (checkins[today]) {
      return { ok: false, reason: 'already', streak: currentStreak(checkins, today) };
    }

    checkins[today] = true;
    Store.writeCheckins(checkins);

    const streak = currentStreak(checkins, today);
    const award = addExp(CHECKIN_EXP, 'checkin', today);

    // 连续打卡每满 7 天 +20；用里程碑编号做 refId，保证同一天数不重复发放
    const milestones = Math.floor(streak / STREAK_BONUS_EVERY);
    const profile = Store.readProfile();
    let bonus = 0;
    let leveledUp = Boolean(award.leveledUp);
    if (milestones > 0 && milestones > (profile.streakBonusCount || 0)) {
      const bonusAward = addExp(STREAK_BONUS_EXP, 'streak', 'day' + milestones * STREAK_BONUS_EVERY);
      if (bonusAward.awarded) {
        bonus = bonusAward.amount;
        leveledUp = leveledUp || Boolean(bonusAward.leveledUp);
      }
      const updated = Store.readProfile();
      updated.streakBonusCount = milestones;
      updated.streak = streak;
      updated.lastCheckin = today;
      Store.writeProfile(updated);
    } else {
      const updated = Store.readProfile();
      updated.streak = streak;
      updated.lastCheckin = today;
      Store.writeProfile(updated);
    }

    return {
      ok: true,
      streak: streak,
      exp: award.awarded ? award.amount : 0,
      bonus: bonus,
      leveledUp: leveledUp
    };
  }

  /* ------------------------- 渲染 ------------------------- */
  function render(options) {
    const opts = options || {};
    const profile = get();
    const level = profile.level;
    const floor = totalFor(level);
    const ceiling = totalFor(level + 1);
    const span = ceiling - floor;
    const inLevel = profile.exp - floor;
    const percent = span > 0 ? Math.round(Util.clamp((inLevel / span) * 100, 0, 100)) : 100;

    const nameEl = document.getElementById('level-name');
    const expEl = document.getElementById('level-exp');
    const trackEl = document.getElementById('exp-track');
    const fillEl = document.getElementById('exp-fill');

    if (nameEl) nameEl.textContent = 'Lv.' + level + ' ' + titleFor(level);
    if (expEl) expEl.textContent = inLevel + ' / ' + span + ' 经验';
    if (fillEl) fillEl.style.width = percent + '%';
    if (trackEl) {
      trackEl.setAttribute('aria-valuenow', String(percent));
      trackEl.setAttribute('aria-valuemax', '100');
      trackEl.setAttribute('title', '累计 ' + profile.exp + ' 经验，距离下一级还差 ' + (ceiling - profile.exp) + ' 点');
    }

    if (opts.leveledUp && expEl) {
      expEl.classList.remove('is-flash');
      // 强制重排，让动画可以连续触发
      void expEl.offsetWidth;
      expEl.classList.add('is-flash');
    }

    const button = document.getElementById('btn-checkin');
    const label = document.getElementById('checkin-label');
    if (button && label) {
      const done = todayCheckedIn();
      button.classList.toggle('is-done', done);
      label.textContent = done ? '今日已打卡' : '今日打卡';
      button.setAttribute('aria-pressed', done ? 'true' : 'false');
    }

    renderHeatmap();
  }

  /** 最近八周打卡热力图：每列一周，周一在上 */
  function renderHeatmap() {
    const host = document.getElementById('heatmap');
    if (!host) return;

    const checkins = Store.readCheckins();
    const today = Util.todayStr();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const thisMonday = Util.startOfWeek(new Date());
    const start = new Date(thisMonday.getTime() - 7 * 7 * DAY_MS);
    const cells = [];

    for (let week = 0; week < 8; week += 1) {
      for (let day = 0; day < 7; day += 1) {
        const date = new Date(start.getTime() + (week * 7 + day) * DAY_MS);
        const key = Util.toDateStr(date);
        const on = Boolean(checkins[key]);
        const classes = ['heat-cell'];
        if (key === today) classes.push('is-today');
        if (key > today) classes.push('is-future');
        if (on) classes.push('is-on');
        cells.push(
          '<span class="' +
            classes.join(' ') +
            '" title="' +
            key +
            (on ? ' 已打卡' : ' 未打卡') +
            '"></span>'
        );
      }
    }

    host.innerHTML = cells.join('');
    const total = Object.keys(checkins).length;
    host.setAttribute('aria-label', '最近八周打卡热力图，累计打卡 ' + total + ' 天');
  }

  /**
   * 升级提示文案，避免调用方各自拼字符串。
   * @param {number} level 新等级
   */
  function levelUpMessage(level) {
    return '升到 ' + level + ' 级了：' + titleFor(level) + '。';
  }

  LL.Profile = {
    CHECKIN_EXP,
    STREAK_BONUS_EXP,
    GOAL_DONE_EXP,
    stepFor,
    totalFor,
    levelFromExp,
    titleFor,
    taskExp,
    get,
    addExp,
    awardTask,
    awardGoal,
    currentStreak,
    todayCheckedIn,
    checkin,
    render,
    renderHeatmap,
    levelUpMessage
  };
})(typeof window !== 'undefined' ? window : globalThis);
