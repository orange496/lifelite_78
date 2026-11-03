/*!
 * goals.js — 目标管理（F1）与目标进度（F3）
 * ---------------------------------------------------------------------------
 * 职责：
 *   · 目标的增删改查、状态流转（active / done / archived）、级联删除；
 *   · 目标进度的计算与三档配色；
 *   · 目标弹窗的表单读写（新建与编辑共用一套字段）。
 * 约定：本文件只操作数据与目标列表 DOM；全局按钮、快捷键、Toast 由 app.js 负责。
 * 依赖：storage.js、profile.js（完成目标发经验）、app.js 的 LL.ui（运行时）。
 */
(function (global) {
  'use strict';

  const LL = (global.LL = global.LL || {});
  const Store = LL.Storage;
  const CONST = LL.CONST;
  const Util = LL.Util;

  const EMPTY_GOALS = '还没有目标。从一个这学期想完成的事情开始吧。';
  const EMPTY_ARCHIVED = '还没有归档的目标。归档的目标会出现在这里，可以随时恢复。';
  const MAX_TITLE = 60;
  const MAX_DESC = 300;

  const COLOR_LABELS = { blue: '蓝色', green: '绿色', amber: '琥珀色', violet: '紫色', slate: '灰色' };

  /* ------------------------- 模块内状态 ------------------------- */
  let selectedId = null; // 当前选中的目标，任务区跟着它走
  let view = 'active'; // 'active' | 'archived'
  let editingId = null; // 弹窗正在编辑的目标，null 表示新建

  /* ------------------------- 读取 ------------------------- */
  function list() {
    // 新目标排在最前：createdAt 是带时区的 ISO 字符串，同机生成可直接字典序比较。
    // 同一毫秒内新建的两个目标比较结果为 0，稳定排序会保留存储顺序（create 用 unshift 置顶）。
    return Store.readGoals()
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function get(id) {
    return Store.readGoals().find((goal) => goal.id === id) || null;
  }

  function selectedIdValue() {
    return selectedId;
  }

  function currentView() {
    return view;
  }

  function tasksOf(goalId, tasks) {
    const all = tasks || Store.readTasks();
    return all.filter((task) => task.goalId === goalId);
  }

  /* ------------------------- F3 进度 ------------------------- */
  /**
   * 目标进度：已完成任务数 / 任务总数。
   * 一条任务都没有时不算 0%，而是「尚未拆解」——空状态优先于数字。
   * @returns {{total:number, done:number, percent:number, tone:string|null,
   *            isEmpty:boolean, label:string}}
   */
  function progress(goalIdOrGoal, tasks) {
    const goalId = typeof goalIdOrGoal === 'string' ? goalIdOrGoal : goalIdOrGoal && goalIdOrGoal.id;
    const list_ = tasksOf(goalId, tasks);
    const total = list_.length;
    const done = list_.filter((task) => task.done).length;
    if (total === 0) {
      return { total: 0, done: 0, percent: 0, tone: null, isEmpty: true, label: '尚未拆解' };
    }
    const percent = Math.floor((done / total) * 100);
    let tone = 'low';
    if (percent >= 100) tone = 'full';
    else if (percent >= 30) tone = 'mid';
    return {
      total: total,
      done: done,
      percent: percent,
      tone: tone,
      isEmpty: false,
      label: done + ' / ' + total + ' · ' + percent + '%'
    };
  }

  /* ------------------------- 写操作 ------------------------- */
  function refresh() {
    if (LL.App && typeof LL.App.refresh === 'function') LL.App.refresh();
  }

  function toast(text, options) {
    if (LL.ui && typeof LL.ui.toast === 'function') LL.ui.toast(text, options);
  }

  function ensureSelection(goals) {
    const all = goals || Store.readGoals();
    if (selectedId && all.some((goal) => goal.id === selectedId)) return;
    const firstActive = all.filter((goal) => goal.status !== 'archived')[0];
    selectedId = firstActive ? firstActive.id : null;
  }

  /**
   * 新建目标。
   * 重名只提示、不阻止保存（方案 F1 规则）。
   */
  function create(data) {
    const title = Util.clip(data && data.title, MAX_TITLE);
    if (!title) return { ok: false, message: '目标名称不能为空。' };

    const goals = Store.readGoals();
    const duplicated = goals.some((goal) => goal.title === title);
    const goal = {
      id: Util.uid('g'),
      title: title,
      desc: Util.clip(data && data.desc, MAX_DESC),
      due: data && data.due ? String(data.due) : null,
      color: CONST.GOAL_COLORS.indexOf(data && data.color) >= 0 ? data.color : 'blue',
      status: 'active',
      createdAt: Util.nowISO()
    };
    goals.unshift(goal);
    if (!Store.writeGoals(goals)) {
      return { ok: false, message: '保存失败，请检查浏览器存储设置。' };
    }
    selectedId = goal.id;
    if (duplicated) toast('已有同名目标，仍然帮你保存了。', { tone: 'warn' });
    return { ok: true, goal: goal, duplicated: duplicated };
  }

  /** 编辑目标：只覆盖允许修改的字段，id / createdAt / status 保持不变 */
  function update(id, data) {
    const goals = Store.readGoals();
    const goal = goals.find((item) => item.id === id);
    if (!goal) return { ok: false, message: '目标不存在，可能已被删除。' };

    const title = Util.clip(data && data.title, MAX_TITLE);
    if (!title) return { ok: false, message: '目标名称不能为空。' };

    goal.title = title;
    goal.desc = Util.clip(data && data.desc, MAX_DESC);
    goal.due = data && data.due ? String(data.due) : null;
    if (data && CONST.GOAL_COLORS.indexOf(data.color) >= 0) goal.color = data.color;
    if (!Store.writeGoals(goals)) return { ok: false, message: '保存失败，请检查浏览器存储设置。' };
    return { ok: true, goal: goal };
  }

  /**
   * 完成 / 重新打开 / 归档 / 恢复。
   * 完成目标发 50 经验（同一目标只发一次）；重新打开不回收经验（只加不减）。
   */
  function setStatus(id, status) {
    if (CONST.GOAL_STATUS.indexOf(status) < 0) return { ok: false };
    const goals = Store.readGoals();
    const goal = goals.find((item) => item.id === id);
    if (!goal) return { ok: false, message: '目标不存在，可能已被删除。' };
    const before = goal.status;
    goal.status = status;
    if (!Store.writeGoals(goals)) return { ok: false, message: '保存失败，请检查浏览器存储设置。' };

    let award = null;
    if (status === 'done' && before !== 'done') {
      award = LL.Profile.awardGoal(goal.id);
      if (award.awarded) {
        toast('目标完成，+' + award.amount + ' 经验。', { tone: 'ok' });
      } else {
        toast('目标完成。', { tone: 'ok' });
      }
      if (award.leveledUp) {
        toast(LL.Profile.levelUpMessage(award.after), { tone: 'ok' });
      }
    } else if (status === 'active' && before === 'done') {
      toast('目标已重新打开，已获得的经验不会收回。', { tone: 'warn' });
    } else if (status === 'archived') {
      toast('已归档，可在「已归档」里恢复。');
    } else if (status === 'active' && before === 'archived') {
      toast('已恢复到进行中。', { tone: 'ok' });
    }
    return { ok: true, goal: goal, award: award };
  }

  /**
   * 删除目标并级联删除它的任务（方案 F1 / 数据规则）。
   * 二次确认文案里的任务数是动态的。
   */
  function remove(id, options) {
    const opts = options || {};
    const goals = Store.readGoals();
    const goal = goals.find((item) => item.id === id);
    if (!goal) return Promise.resolve({ ok: false });
    const count = tasksOf(id).length;
    const message =
      '删除后不可恢复，该目标下的 ' + count + ' 个任务也会一起删除。';

    if (opts.purge && goal.status !== 'archived') {
      // 已归档目标是唯一允许「彻底删除」的对象；进行中的目标必须先归档
      return Promise.resolve({ ok: false, message: '请先把目标归档，再进行彻底删除。' });
    }

    return LL.ui
      .confirm({
        title: '删除目标「' + Util.clip(goal.title, 18) + '」？',
        message: message,
        okText: opts.purge ? '彻底删除' : '删除',
        danger: true
      })
      .then((confirmed) => {
        if (!confirmed) return { ok: false, canceled: true };

        const tasks = Store.readTasks().filter((task) => task.goalId !== id);
        Store.writeTasks(tasks);
        const remaining = Store.readGoals().filter((item) => item.id !== id);
        Store.writeGoals(remaining);
        if (selectedId === id) selectedId = null;
        ensureSelection(remaining);
        refresh();
        toast('目标已删除。', { tone: 'ok' });
        return { ok: true, removedTasks: count };
      });
  }

  /* ------------------------- 选中与视图 ------------------------- */
  function select(id) {
    selectedId = id ? String(id) : null;
  }

  function setView(next) {
    if (next !== 'active' && next !== 'archived') return;
    view = next;
  }

  /* ------------------------- 目标弹窗 ------------------------- */
  function buildColorOptions() {
    const host = document.getElementById('goal-colors');
    if (!host || host.childElementCount > 0) return;
    host.innerHTML = CONST.GOAL_COLORS.map((color) => {
      return (
        '<label class="color-option" data-color="' +
        color +
        '" title="' +
        COLOR_LABELS[color] +
        '">' +
        '<input type="radio" name="goal-color" value="' +
        color +
        '">' +
        '<span class="sr-only">' +
        COLOR_LABELS[color] +
        '</span>' +
        '</label>'
      );
    }).join('');
  }

  function dialog() {
    return document.getElementById('goal-dialog');
  }

  function openCreate() {
    const el = dialog();
    if (!el) return;
    editingId = null;
    buildColorOptions();
    const form = document.getElementById('goal-form');
    form.reset();
    document.getElementById('goal-dialog-title').textContent = '新建目标';
    const color = form.querySelector('input[name="goal-color"][value="blue"]');
    if (color) color.checked = true;
    // 截止日期留空；默认给一个学期末的提示由 placeholder 承担
    el.showModal();
    document.getElementById('goal-title').focus();
  }

  function openEdit(id) {
    const goal = get(id);
    const el = dialog();
    if (!goal || !el) return;
    editingId = id;
    buildColorOptions();
    const form = document.getElementById('goal-form');
    form.reset();
    document.getElementById('goal-dialog-title').textContent = '编辑目标';
    document.getElementById('goal-title').value = goal.title;
    document.getElementById('goal-desc').value = goal.desc || '';
    document.getElementById('goal-due').value = goal.due || '';
    const color = form.querySelector('input[name="goal-color"][value="' + goal.color + '"]');
    if (color) color.checked = true;
    el.showModal();
    document.getElementById('goal-title').focus();
    document.getElementById('goal-title').select();
  }

  /** 从表单收集字段并保存；返回 {ok, goal} 供 app.js 决定后续焦点 */
  function submit(form) {
    const el = form || document.getElementById('goal-form');
    const data = {
      title: document.getElementById('goal-title').value,
      desc: document.getElementById('goal-desc').value,
      due: document.getElementById('goal-due').value,
      color: (el.querySelector('input[name="goal-color"]:checked') || {}).value || 'blue'
    };

    const trimmed = Util.clip(data.title, MAX_TITLE);
    if (!trimmed) {
      toast('目标名称不能为空。', { tone: 'error' });
      document.getElementById('goal-title').focus();
      return { ok: false };
    }

    const result = editingId ? update(editingId, data) : create(data);
    if (!result.ok) {
      toast(result.message || '保存失败。', { tone: 'error' });
      return result;
    }

    const el2 = dialog();
    if (el2) el2.close();
    const isNew = !editingId;
    editingId = null;
    refresh();
    if (isNew) toast('目标已创建。', { tone: 'ok' });
    else toast('目标已更新。', { tone: 'ok' });
    return result;
  }

  /* ------------------------- 渲染 ------------------------- */
  function dueHtml(goal) {
    if (!goal.due) return '';
    const overdue = Util.isPastDay(goal.due) && goal.status !== 'done';
    return (
      '<span class="due' +
      (overdue ? ' is-overdue' : '') +
      '">' +
      (overdue ? '已逾期 · ' : '截止 ') +
      Util.fmtDue(goal.due) +
      '</span>'
    );
  }

  function actionsHtml(goal) {
    const buttons = [];
    buttons.push(
      '<button class="icon-btn" type="button" data-act="edit" title="编辑目标" aria-label="编辑目标">✎</button>'
    );
    if (goal.status === 'done') {
      buttons.push(
        '<button class="icon-btn" type="button" data-act="reopen" title="重新打开" aria-label="重新打开目标">↺</button>'
      );
    } else if (goal.status === 'active') {
      buttons.push(
        '<button class="icon-btn" type="button" data-act="done" title="标记完成" aria-label="标记目标完成">✓</button>'
      );
    }
    if (goal.status === 'archived') {
      buttons.push(
        '<button class="icon-btn" type="button" data-act="unarchive" title="恢复" aria-label="恢复目标">⤴</button>'
      );
      buttons.push(
        '<button class="icon-btn is-danger" type="button" data-act="purge" title="彻底删除" aria-label="彻底删除目标">✕</button>'
      );
    } else {
      buttons.push(
        '<button class="icon-btn" type="button" data-act="archive" title="归档" aria-label="归档目标">▤</button>'
      );
      buttons.push(
        '<button class="icon-btn is-danger" type="button" data-act="delete" title="删除" aria-label="删除目标">✕</button>'
      );
    }
    return '<div class="goal-card-actions">' + buttons.join('') + '</div>';
  }

  function cardHtml(goal, tasks) {
    const info = progress(goal, tasks);
    const classes = ['goal-card'];
    if (goal.id === selectedId) classes.push('is-selected');
    if (goal.status === 'done') classes.push('is-done');
    if (goal.status === 'archived') classes.push('is-archived');

    const tick = goal.status === 'done' ? '<span class="tick" aria-hidden="true">✓</span>' : '';
    const desc = goal.desc ? '<p class="goal-desc">' + Util.esc(goal.desc) + '</p>' : '';
    const badge =
      goal.status === 'done'
        ? '<span class="badge is-done">已完成</span>'
        : goal.status === 'archived'
          ? '<span class="badge is-archived">已归档</span>'
          : '';
    const taskCount = info.total === 0 ? '尚无任务' : info.total + ' 个任务';

    return (
      '<li class="' +
      classes.join(' ') +
      '" data-goal-id="' +
      Util.esc(goal.id) +
      '" data-color="' +
      goal.color +
      '" tabindex="0" role="button" aria-pressed="' +
      (goal.id === selectedId ? 'true' : 'false') +
      '" aria-label="' +
      Util.esc(goal.title) +
      (goal.status === 'done' ? '，已完成' : '') +
      '">' +
      '<div class="goal-card-head">' +
      '<h3 class="goal-name">' +
      tick +
      Util.esc(goal.title) +
      '</h3>' +
      actionsHtml(goal) +
      '</div>' +
      desc +
      '<div class="goal-meta">' +
      dueHtml(goal) +
      '<span>' +
      taskCount +
      '</span>' +
      badge +
      '</div>' +
      '<div class="goal-progress">' +
      '<div class="progress' +
      (info.isEmpty ? ' is-empty' : '') +
      '"><div class="progress-fill" data-tone="' +
      (info.tone || 'low') +
      '" style="width:' +
      (info.isEmpty ? 0 : info.percent) +
      '%"></div></div>' +
      '<span class="goal-progress-text">' +
      info.label +
      '</span>' +
      '</div>' +
      '</li>'
    );
  }

  function render() {
    const goals = list();
    const tasks = Store.readTasks();
    ensureSelection(goals);

    const visible = goals.filter((goal) => {
      return view === 'archived' ? goal.status === 'archived' : goal.status !== 'archived';
    });

    const host = document.getElementById('goal-list');
    if (host) {
      host.innerHTML = visible.map((goal) => cardHtml(goal, tasks)).join('');
    }

    const emptyEl = document.getElementById('goal-empty');
    const emptyTitle = document.getElementById('goal-empty-title');
    const emptyButton = document.getElementById('btn-empty-new-goal');
    if (emptyEl) emptyEl.hidden = visible.length > 0;
    if (emptyTitle) {
      emptyTitle.textContent =
        visible.length > 0
          ? ''
          : goals.length === 0
            ? EMPTY_GOALS
            : view === 'archived'
              ? EMPTY_ARCHIVED
              : '进行中的目标都处理完了。新建一个，或者去「已归档」看看。';
    }
    if (emptyButton) {
      emptyButton.textContent = view === 'archived' ? '新建目标' : '新建第一个目标';
      emptyButton.hidden = view === 'archived';
    }

    document.querySelectorAll('.goal-tabs .tab').forEach((tab) => {
      const isActive = tab.dataset.view === view;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  LL.Goals = {
    EMPTY_GOALS,
    MAX_TITLE,
    MAX_DESC,
    list,
    get,
    tasksOf,
    progress,
    create,
    update,
    setStatus,
    remove,
    select,
    setView,
    selectedId: selectedIdValue,
    currentView,
    openCreate,
    openEdit,
    submit,
    render,
    refresh
  };
})(typeof window !== 'undefined' ? window : globalThis);
