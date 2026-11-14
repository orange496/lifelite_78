/*!
 * tasks.js — 任务管理（F2）
 * ---------------------------------------------------------------------------
 * 职责：
 *   · 任务的新建、编辑、删除、完成 / 撤销完成；
 *   · 任务列表排序：未完成在前（优先级 → 截止时间升序），已完成沉底（完成时间倒序）；
 *   · 已完成区的折叠（单目标超过 20 条任务时默认折叠）；
 *   · 任务弹窗的表单读写与经验提示。
 * 经验值由 profile.js 发放并按任务 id 去重：撤销完成、删除任务都不回收经验。
 * 依赖：storage.js、profile.js、goals.js（取当前选中目标）、app.js 的 LL.ui（运行时）。
 */
(function (global) {
  'use strict';

  const LL = (global.LL = global.LL || {});
  const Store = LL.Storage;
  const CONST = LL.CONST;
  const Util = LL.Util;

  const MAX_TITLE = 80;
  const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };
  const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };

  /* ------------------------- 模块内状态 ------------------------- */
  let editingId = null;

  /* ------------------------- 读取与排序 ------------------------- */
  function read() {
    return Store.readTasks();
  }

  function get(id) {
    return Store.readTasks().find((task) => task.id === id) || null;
  }

  function dueTime(task) {
    const time = task && task.due ? Date.parse(task.due) : NaN;
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  }

  function compare(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done && b.done) {
      return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
    }
    const weight = (PRIORITY_WEIGHT[a.priority] || 0) - (PRIORITY_WEIGHT[b.priority] || 0);
    if (weight !== 0) return weight;
    const gap = dueTime(a) - dueTime(b);
    if (gap !== 0) return gap;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }

  /** 某个目标下的任务，已按展示顺序排好 */
  function listOf(goalId, tasks) {
    const all = tasks || read();
    return all.filter((task) => task.goalId === goalId).slice().sort(compare);
  }

  function isOverdue(task) {
    return Boolean(task && task.due && !task.done && Date.parse(task.due) < Date.now());
  }

  /* ------------------------- 写操作 ------------------------- */
  function refresh() {
    if (LL.App && typeof LL.App.refresh === 'function') LL.App.refresh();
  }

  function toast(text, options) {
    if (LL.ui && typeof LL.ui.toast === 'function') LL.ui.toast(text, options);
  }

  function goalsForSelect() {
    // 已归档的目标不能再接新任务
    return LL.Goals.list().filter((goal) => goal.status !== 'archived');
  }

  function create(data) {
    const title = Util.clip(data && data.title, MAX_TITLE);
    if (!title) return { ok: false, message: '子任务标题不能为空。' };

    const goalId = data && data.goalId;
    const target = LL.Goals.get(goalId);
    if (!target) return { ok: false, message: '请先选择一个所属主任务。' };
    if (target.status === 'archived') return { ok: false, message: '已归档的主任务不能添加子任务。' };

    const estimate = CONST.ESTIMATES.indexOf(Number(data.estimate)) >= 0 ? Number(data.estimate) : null;
    const task = {
      id: Util.uid('t'),
      goalId: goalId,
      title: title,
      priority: CONST.PRIORITIES.indexOf(data.priority) >= 0 ? data.priority : 'medium',
      estimate: estimate,
      due: data.due ? String(data.due) : null,
      done: false,
      completedAt: null,
      createdAt: Util.nowISO()
    };

    const tasks = read();
    tasks.push(task);
    if (!Store.writeTasks(tasks)) {
      return { ok: false, message: '保存失败，请检查浏览器存储设置。' };
    }
    return { ok: true, task: task };
  }

  function update(id, data) {
    const tasks = read();
    const task = tasks.find((item) => item.id === id);
    if (!task) return { ok: false, message: '子任务不存在，可能已被删除。' };

    const title = Util.clip(data && data.title, MAX_TITLE);
    if (!title) return { ok: false, message: '子任务标题不能为空。' };

    const goalId = data && data.goalId ? data.goalId : task.goalId;
    const target = LL.Goals.get(goalId);
    if (!target) return { ok: false, message: '所属主任务不存在。' };
    if (target.status === 'archived') return { ok: false, message: '已归档的主任务不能存放子任务。' };

    task.title = title;
    task.goalId = goalId;
    if (data && CONST.PRIORITIES.indexOf(data.priority) >= 0) task.priority = data.priority;
    task.estimate = CONST.ESTIMATES.indexOf(Number(data && data.estimate)) >= 0
      ? Number(data.estimate)
      : null;
    task.due = data && data.due ? String(data.due) : null;
    if (!Store.writeTasks(tasks)) return { ok: false, message: '保存失败，请检查浏览器存储设置。' };
    return { ok: true, task: task };
  }

  /**
   * 完成 / 撤销完成。
   * 完成时发经验（按任务 id 去重）；撤销只清空 completedAt，经验不回收。
   */
  function toggle(id) {
    const tasks = read();
    const task = tasks.find((item) => item.id === id);
    if (!task) return { ok: false, message: '子任务不存在，可能已被删除。' };

    if (task.done) {
      task.done = false;
      task.completedAt = null;
      Store.writeTasks(tasks);
      refresh();
      toast('已取消完成。经验不会收回，这是刻意的设计。', { tone: 'warn' });
      return { ok: true, done: false };
    }

    task.done = true;
    task.completedAt = Util.nowISO();
    Store.writeTasks(tasks);

    const award = LL.Profile.awardTask(task);
    refresh();
    if (award.awarded) {
      toast('子任务完成，+' + award.amount + ' 经验。', {
        tone: 'ok',
        detail: award.leveledUp ? LL.Profile.levelUpMessage(award.after) : ''
      });
    } else {
      toast('子任务完成。', { tone: 'ok' });
    }
    return { ok: true, done: true, award: award };
  }

  /** 删除任务：确认后移出存储，返回被删对象供 app.js 提供 10 秒撤销 */
  function remove(id) {
    const tasks = read();
    const index = tasks.findIndex((item) => item.id === id);
    if (index < 0) return Promise.resolve({ ok: false });
    const removed = tasks[index];
    const message = '删除的子任务可以在 10 秒内撤销。';

    return LL.ui
      .confirm({
        title: '删除子任务「' + Util.clip(removed.title, 18) + '」？',
        message: message,
        okText: '删除',
        danger: true
      })
      .then((confirmed) => {
        if (!confirmed) return { ok: false, canceled: true };
        const rest = read().filter((item) => item.id !== id);
        Store.writeTasks(rest);
        refresh();
        return { ok: true, removed: removed };
      });
  }

  /** 撤销删除：把任务放回列表（保留原 id，经验记录不受影响） */
  function restore(task) {
    if (!task || !task.id) return { ok: false };
    const tasks = read();
    if (tasks.some((item) => item.id === task.id)) return { ok: false };
    if (!LL.Goals.get(task.goalId)) return { ok: false, message: '所属目标已被删除，无法恢复。' };
    tasks.push(task);
    if (!Store.writeTasks(tasks)) return { ok: false };
    refresh();
    return { ok: true, task: task };
  }

  /* ------------------------- 任务弹窗 ------------------------- */
  function dialog() {
    return document.getElementById('task-dialog');
  }

  function fillGoalOptions(selectedGoalId) {
    const select = document.getElementById('task-goal');
    if (!select) return;
    const goals = goalsForSelect();
    select.innerHTML = goals
      .map((goal) => {
        return (
          '<option value="' +
          Util.esc(goal.id) +
          '"' +
          (goal.id === selectedGoalId ? ' selected' : '') +
          '>' +
          Util.esc(goal.title) +
          '</option>'
        );
      })
      .join('');
    select.disabled = goals.length === 0;
  }

  function expHint() {
    const hint = document.getElementById('task-exp-hint');
    const estimate = document.getElementById('task-estimate');
    if (!hint || !estimate) return;
    hint.textContent = String(LL.Profile.taskExp(estimate.value));
  }

  function openCreate(goalId) {
    const goals = goalsForSelect();
    if (goals.length === 0) {
      toast('先新建一个主任务，再往里面拆子任务。', { tone: 'warn' });
      return false;
    }
    const el = dialog();
    if (!el) return false;
    editingId = null;
    const form = document.getElementById('task-form');
    form.reset();
    document.getElementById('task-dialog-title').textContent = '新建子任务';
    fillGoalOptions(goalId || LL.Goals.selectedId() || goals[0].id);
    expHint();
    el.showModal();
    document.getElementById('task-title').focus();
    return true;
  }

  function openEdit(id) {
    const task = get(id);
    const el = dialog();
    if (!task || !el) return false;
    editingId = id;
    const form = document.getElementById('task-form');
    form.reset();
    document.getElementById('task-dialog-title').textContent = '编辑子任务';
    fillGoalOptions(task.goalId);
    document.getElementById('task-title').value = task.title;
    document.getElementById('task-priority').value = task.priority;
    document.getElementById('task-estimate').value = task.estimate == null ? '' : String(task.estimate);
    document.getElementById('task-due').value = task.due || '';
    expHint();
    el.showModal();
    document.getElementById('task-title').focus();
    document.getElementById('task-title').select();
    return true;
  }

  function submit() {
    const estimateValue = document.getElementById('task-estimate').value;
    const data = {
      title: document.getElementById('task-title').value,
      goalId: document.getElementById('task-goal').value,
      priority: document.getElementById('task-priority').value,
      estimate: estimateValue === '' ? null : Number(estimateValue),
      due: document.getElementById('task-due').value
    };

    if (!Util.clip(data.title, MAX_TITLE)) {
      toast('子任务标题不能为空。', { tone: 'error' });
      document.getElementById('task-title').focus();
      return { ok: false };
    }
    if (!data.goalId) {
      toast('请先选择一个所属主任务。', { tone: 'error' });
      return { ok: false };
    }

    const result = editingId ? update(editingId, data) : create(data);
    if (!result.ok) {
      toast(result.message || '保存失败。', { tone: 'error' });
      return result;
    }

    const isNew = !editingId;
    editingId = null;
    const el2 = dialog();
    if (el2) el2.close();
    if (isNew) LL.Goals.select(result.task.goalId);
    refresh();
    toast(isNew ? '子任务已添加。' : '子任务已更新。', { tone: 'ok' });
    return result;
  }

  LL.Tasks = {
    MAX_TITLE,
    read,
    get,
    listOf,
    isOverdue,
    compare,
    create,
    update,
    toggle,
    remove,
    restore,
    openCreate,
    openEdit,
    submit,
    expHint
  };
})(typeof window !== 'undefined' ? window : globalThis);
