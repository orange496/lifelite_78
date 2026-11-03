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
  const collapsed = Object.create(null); // goalId → true 表示已完成区收起

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
    if (!title) return { ok: false, message: '任务标题不能为空。' };

    const goalId = data && data.goalId;
    const target = LL.Goals.get(goalId);
    if (!target) return { ok: false, message: '请先选择一个所属目标。' };
    if (target.status === 'archived') return { ok: false, message: '已归档的目标不能新建任务。' };

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
    if (!task) return { ok: false, message: '任务不存在，可能已被删除。' };

    const title = Util.clip(data && data.title, MAX_TITLE);
    if (!title) return { ok: false, message: '任务标题不能为空。' };

    const goalId = data && data.goalId ? data.goalId : task.goalId;
    const target = LL.Goals.get(goalId);
    if (!target) return { ok: false, message: '所属目标不存在。' };
    if (target.status === 'archived') return { ok: false, message: '已归档的目标不能存放任务。' };

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
    if (!task) return { ok: false, message: '任务不存在，可能已被删除。' };

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
      toast('任务完成，+' + award.amount + ' 经验。', {
        tone: 'ok',
        detail: award.leveledUp ? LL.Profile.levelUpMessage(award.after) : ''
      });
    } else {
      toast('任务完成。', { tone: 'ok' });
    }
    return { ok: true, done: true, award: award };
  }

  /** 删除任务：确认后移出存储，返回被删对象供 app.js 提供 10 秒撤销 */
  function remove(id) {
    const tasks = read();
    const index = tasks.findIndex((item) => item.id === id);
    if (index < 0) return Promise.resolve({ ok: false });
    const removed = tasks[index];
    const message = '删除的任务可以在 10 秒内撤销。';

    return LL.ui
      .confirm({
        title: '删除任务「' + Util.clip(removed.title, 18) + '」？',
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

  /* ------------------------- 折叠 ------------------------- */
  function isCollapsed(goalId, total) {
    if (typeof collapsed[goalId] === 'boolean') return collapsed[goalId];
    return total > CONST.COLLAPSE_THRESHOLD;
  }

  function toggleCollapse(goalId, total) {
    collapsed[goalId] = !isCollapsed(goalId, total);
    refresh();
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
      toast('先新建一个目标，再往里面拆任务。', { tone: 'warn' });
      return false;
    }
    const el = dialog();
    if (!el) return false;
    editingId = null;
    const form = document.getElementById('task-form');
    form.reset();
    document.getElementById('task-dialog-title').textContent = '新建任务';
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
    document.getElementById('task-dialog-title').textContent = '编辑任务';
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
      toast('任务标题不能为空。', { tone: 'error' });
      document.getElementById('task-title').focus();
      return { ok: false };
    }
    if (!data.goalId) {
      toast('请先选择一个所属目标。', { tone: 'error' });
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
    toast(isNew ? '任务已添加。' : '任务已更新。', { tone: 'ok' });
    return result;
  }

  /* ------------------------- 渲染 ------------------------- */
  function rowHtml(task) {
    const overdue = isOverdue(task);
    const classes = ['task-row'];
    if (task.done) classes.push('is-done');
    if (overdue) classes.push('is-overdue');

    const priority = task.priority || 'medium';
    const chips = [
      '<span class="chip is-' + priority + '">' + PRIORITY_LABEL[priority] + '优先级</span>'
    ];
    if (task.estimate) {
      chips.push('<span class="chip">' + task.estimate + ' 分钟</span>');
    }
    if (task.due) {
      chips.push(
        '<span class="chip' +
          (overdue ? ' is-overdue' : '') +
          '">' +
          (overdue ? '已逾期 ' : '截止 ') +
          Util.fmtDateTime(task.due) +
          '</span>'
      );
    }
    chips.push('<span class="chip is-exp">+' + LL.Profile.taskExp(task.estimate) + ' 经验</span>');

    return (
      '<div class="' +
      classes.join(' ') +
      '" data-task-id="' +
      Util.esc(task.id) +
      '">' +
      '<button class="task-check" type="button" data-act="toggle" aria-pressed="' +
      (task.done ? 'true' : 'false') +
      '" aria-label="' +
      (task.done ? '标记为未完成' : '标记为完成') +
      '">✓</button>' +
      '<div class="task-main">' +
      '<div class="task-title">' +
      Util.esc(task.title) +
      '</div>' +
      '<div class="task-meta">' +
      chips.join('') +
      '</div>' +
      '</div>' +
      '<div class="task-actions">' +
      '<button class="icon-btn" type="button" data-act="edit" title="编辑任务" aria-label="编辑任务">✎</button>' +
      '<button class="icon-btn is-danger" type="button" data-act="delete" title="删除任务" aria-label="删除任务">✕</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderEmpty(mode) {
    const emptyEl = document.getElementById('task-empty');
    const titleEl = document.getElementById('task-empty-title');
    const button = document.getElementById('btn-empty-new-task');
    if (emptyEl) emptyEl.hidden = false;
    if (titleEl) {
      titleEl.textContent =
        mode === 'no-goals'
          ? '先建一个目标，再往里面放任务。'
          : mode === 'no-tasks'
            ? '这个目标还没有拆解。加一个小任务，先动起来。'
            : '从左侧选一个目标，或者先新建一个目标。';
    }
    if (button) {
      button.textContent = mode === 'no-goals' ? '新建目标' : '新建任务';
      button.setAttribute('data-mode', mode);
      button.hidden = mode === 'select';
    }
  }

  function render() {
    const goals = LL.Goals.list();
    const goal = LL.Goals.get(LL.Goals.selectedId());
    const emptyEl = document.getElementById('task-empty');
    const host = document.getElementById('task-list');
    const titleEl = document.getElementById('selected-goal-title');
    const metaEl = document.getElementById('selected-goal-meta');
    const fillEl = document.getElementById('task-progress-fill');
    const textEl = document.getElementById('task-progress-text');
    const progressEl = document.getElementById('task-progress');

    if (!goal) {
      if (titleEl) titleEl.textContent = '还没有选择目标';
      if (metaEl) metaEl.textContent = '';
      if (host) host.innerHTML = '';
      if (fillEl) fillEl.style.width = '0%';
      if (progressEl) {
        progressEl.classList.add('is-empty');
        progressEl.removeAttribute('aria-valuenow');
      }
      if (textEl) textEl.textContent = '尚未拆解';
      renderEmpty(goals.length === 0 ? 'no-goals' : 'select');
      return;
    }

    const tasks = listOf(goal.id);
    const info = LL.Goals.progress(goal, tasks);
    const pending = tasks.filter((task) => !task.done);
    const done = tasks.filter((task) => task.done);

    if (titleEl) titleEl.textContent = goal.title;
    if (metaEl) {
      const parts = [];
      parts.push(info.total === 0 ? '尚无任务' : info.total + ' 个任务，已完成 ' + info.done + ' 个');
      if (goal.due) parts.push('截止 ' + Util.fmtDue(goal.due));
      if (goal.status === 'done') parts.push('目标已完成');
      if (goal.status === 'archived') parts.push('目标已归档');
      metaEl.textContent = parts.join(' · ');
    }

    if (progressEl) {
      progressEl.classList.toggle('is-empty', info.isEmpty);
      if (info.isEmpty) progressEl.removeAttribute('aria-valuenow');
      else progressEl.setAttribute('aria-valuenow', String(info.percent));
    }
    if (fillEl) {
      fillEl.style.width = info.isEmpty ? '0%' : info.percent + '%';
      fillEl.setAttribute('data-tone', info.tone || 'low');
    }
    if (textEl) textEl.textContent = info.label;

    if (!host) return;

    if (tasks.length === 0) {
      host.innerHTML = '';
      renderEmpty('no-tasks');
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const html = [];
    pending.forEach((task) => html.push(rowHtml(task)));

    if (done.length > 0) {
      const isCollapsed_ = isCollapsed(goal.id, tasks.length);
      html.push(
        '<div class="task-group-label">已完成 ' +
          done.length +
          ' 个' +
          (done.length > 3 || tasks.length > CONST.COLLAPSE_THRESHOLD
            ? '<button class="task-group-toggle" type="button" data-act="collapse">' +
              (isCollapsed_ ? '展开' : '收起') +
              '</button>'
            : '') +
          '</div>'
      );
      if (!isCollapsed_) {
        done.forEach((task) => html.push(rowHtml(task)));
      }
    }

    host.innerHTML = html.join('');
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
    isCollapsed,
    toggleCollapse,
    openCreate,
    openEdit,
    submit,
    expHint,
    render
  };
})(typeof window !== 'undefined' ? window : globalThis);
