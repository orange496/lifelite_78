/*!
 * book.js — 记事本的分页、渲染与翻页
 * ---------------------------------------------------------------------------
 * 职责：
 *   · 把「主任务 + 子任务」摊平成固定 14 行的纸页，逐页切分；
 *   · 渲染封面（橙色）、扉页（经验 / 等级 / 统计 / 打卡 / 升级奖励占位）、任务页；
 *   · 点击主任务行展开 / 收起子任务，子任务缩进两字符跟随；
 *   · 从下往上的翻页动画（CSS 3D，prefers-reduced-motion 时直接切换）；
 *   · 行尾「⋯」菜单：加子任务、编辑、归档、删除。
 * 依赖：storage.js、profile.js、goals.js、tasks.js、stats.js、app.js 的 LL.ui / LL.App。
 */
(function (global) {
  'use strict';

  const LL = (global.LL = global.LL || {});
  const Store = LL.Storage;
  const Util = LL.Util;

  /** 每页固定的横线数量 */
  const ROWS = 14;
  const FLIP_MS = 680;

  const state = {
    page: 0, // 0 = 封面，1 = 扉页，>=2 = 任务页
    mode: 'active', // 'active' | 'archived'
    expanded: Object.create(null),
    busy: false,
    menu: null
  };

  let pages = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function toast(text, options) {
    if (LL.ui && typeof LL.ui.toast === 'function') LL.ui.toast(text, options);
  }

  function refresh() {
    if (LL.App && typeof LL.App.refresh === 'function') LL.App.refresh();
  }

  /* =========================================================================
   * 一、数据 → 行
   * ========================================================================= */
  function visibleGoals() {
    return LL.Goals.list().filter((goal) => {
      return state.mode === 'archived' ? goal.status === 'archived' : goal.status !== 'archived';
    });
  }

  function buildRows() {
    const rows = [];
    visibleGoals().forEach((goal, index) => {
      rows.push({ kind: 'goal', goal: goal, index: index + 1 });

      if (state.mode !== 'active' || !state.expanded[goal.id]) return;
      const tasks = LL.Tasks.listOf(goal.id);
      if (tasks.length === 0) {
        rows.push({ kind: 'hint', goal: goal });
      } else {
        tasks.forEach((task) => rows.push({ kind: 'task', goal: goal, task: task }));
      }
      if (goal.status === 'active') rows.push({ kind: 'add-task', goal: goal });
    });
    return rows;
  }

  /** 重新切页；尽量让当前页保持指向原来的内容 */
  function rebuildPages() {
    const rows = buildRows();
    const chunks = [];
    if (rows.length === 0) {
      chunks.push([]);
    } else {
      for (let i = 0; i < rows.length; i += ROWS) chunks.push(rows.slice(i, i + ROWS));
    }
    pages = [{ kind: 'cover' }, { kind: 'front' }].concat(
      chunks.map((chunk) => ({ kind: 'tasks', rows: chunk }))
    );
    if (state.page > pages.length - 1) state.page = pages.length - 1;
    if (state.page < 0) state.page = 0;
  }

  function taskCount(goalId) {
    return Store.readTasks().filter((task) => task.goalId === goalId).length;
  }

  /* =========================================================================
   * 二、页面片段
   * ========================================================================= */
  function coverHtml() {
    const goalCount = visibleGoals().length;
    const year = new Date().getFullYear();
    return (
      '<div class="cover">' +
      '<div class="cover-frame" aria-hidden="true"></div>' +
      '<div>' +
      '<p class="cover-kicker">LifeLite · 学习目标记事本</p>' +
      '<h1 class="cover-title">把想做的事<br>一页一页写完</h1>' +
      '<div class="cover-seal" aria-hidden="true">记</div>' +
      '<p class="cover-sub">' +
      year +
      ' 年 · 已写下 ' +
      goalCount +
      ' 个主任务</p>' +
      '</div>' +
      '<div class="cover-actions">' +
      '<button class="cover-btn" type="button" data-act="export">导出备份</button>' +
      '<button class="cover-btn" type="button" data-act="import">导入备份</button>' +
      '</div>' +
      '<button class="cover-btn" type="button" data-act="next">翻开第一页 →</button>' +
      '</div>'
    );
  }

  function heatmapHtml() {
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
        const classes = ['heat-cell'];
        if (key === today) classes.push('is-today');
        if (key > today) classes.push('is-future');
        if (checkins[key]) classes.push('is-on');
        cells.push(
          '<span class="' + classes.join(' ') + '" title="' + key + (checkins[key] ? ' 已打卡' : ' 未打卡') + '"></span>'
        );
      }
    }
    return '<div class="heatmap" role="img" aria-label="最近八周打卡">' + cells.join('') + '</div>';
  }

  function frontHtml() {
    const profile = LL.Profile.get();
    const level = profile.level;
    const floor = LL.Profile.totalFor(level);
    const ceiling = LL.Profile.totalFor(level + 1);
    const span = ceiling - floor;
    const inLevel = profile.exp - floor;
    const percent = span > 0 ? Math.round(Util.clamp((inLevel / span) * 100, 0, 100)) : 100;
    const info = LL.Stats.summary();
    const checked = LL.Profile.todayCheckedIn();
    const archivedCount = Store.readGoals().filter((goal) => goal.status === 'archived').length;
    const nextLevel = level + 1;

    return (
      '<header class="sheet-head">' +
      '<span class="sheet-title">扉页 · 我的进度</span>' +
      '<span class="sheet-sub">' +
      Util.todayStr() +
      '</span>' +
      '</header>' +
      '<div class="sheet-body">' +
      '<div class="front-hero">' +
      '<div class="front-level">Lv.' +
      level +
      '<small>' +
      LL.Profile.titleFor(level) +
      '</small></div>' +
      '<div class="front-exp">累计经验<strong>' +
      profile.exp +
      '</strong></div>' +
      '</div>' +
      '<div class="front-bar">' +
      '<div class="exp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      percent +
      '" title="累计 ' +
      profile.exp +
      ' 经验，距离 Lv.' +
      nextLevel +
      ' 还差 ' +
      (ceiling - profile.exp) +
      ' 点">' +
      '<div class="exp-fill" style="width:' +
      percent +
      '%"></div>' +
      '</div>' +
      '<span class="front-bar-text">距 Lv.' +
      nextLevel +
      ' 还差 ' +
      (ceiling - profile.exp) +
      ' 经验</span>' +
      '</div>' +
      '<div class="front-stats">' +
      '<div class="front-stat"><b>' +
      info.weekDone +
      '</b><span>本周完成</span></div>' +
      '<div class="front-stat"><b>' +
      info.weekNew +
      '</b><span>本周新增</span></div>' +
      '<div class="front-stat"><b>' +
      (info.rate === null ? '—' : info.rate + '%') +
      '</b><span>整体完成率</span></div>' +
      '<div class="front-stat"><b>' +
      info.streak +
      '</b><span>连续打卡（天）</span></div>' +
      '</div>' +
      '<div class="front-heat">' +
      heatmapHtml() +
      '<div class="front-heat-note"><span>最近八周打卡</span><span>每格一天，深色为已打卡</span></div>' +
      '</div>' +
      '<div class="front-checkin">' +
      '<span class="checkin-note">' +
      (checked ? '今天已经打过卡了，明天见。' : '今天也写下一页，打个卡。') +
      '</span>' +
      '<button class="btn-checkin' +
      (checked ? ' is-done' : '') +
      '" type="button" data-act="checkin" aria-pressed="' +
      (checked ? 'true' : 'false') +
      '">' +
      (checked ? '今日已打卡' : '今日打卡 +5') +
      '</button>' +
      '</div>' +
      '<div class="front-reward">' +
      '<div class="reward-card">' +
      '<span class="reward-icon" aria-hidden="true">★</span>' +
      '<div class="reward-body">' +
      '<span class="reward-title">Lv.' +
      nextLevel +
      ' 升级奖励</span>' +
      '<span class="reward-desc">奖励内容待定，先占个位置。</span>' +
      '</div>' +
      '<span class="reward-placeholder">待揭晓</span>' +
      '</div>' +
      '</div>' +
      '<div class="front-archive">' +
      '<span>已归档 ' +
      archivedCount +
      ' 个主任务</span>' +
      '<button class="archive-link" type="button" data-act="archive-mode">' +
      (state.mode === 'archived' ? '回到记事本 →' : '打开归档箱 →') +
      '</button>' +
      '</div>' +
      '<div class="front-note">把今天想做的，写在同一行上。</div>' +
      '</div>' +
      '<footer class="sheet-foot"><span>扉页</span><span class="foot-hint">左右翻页</span><span>LifeLite</span></footer>'
    );
  }

  function goalRowHtml(row) {
    const goal = row.goal;
    const tasks = LL.Tasks.listOf(goal.id);
    const info = LL.Goals.progress(goal, tasks);
    const expanded = Boolean(state.expanded[goal.id]);
    const classes = ['line', 'line--goal'];
    if (goal.status === 'done') classes.push('is-done');
    if (goal.status === 'archived') classes.push('is-archived');

    const metaParts = [];
    if (state.mode === 'archived') {
      metaParts.push('已归档');
    } else {
      metaParts.push(info.total === 0 ? '未拆解' : info.done + '/' + info.total);
      if (goal.due) metaParts.push((Util.isPastDay(goal.due) && goal.status !== 'done' ? '已逾期 ' : '') + Util.fmtDue(goal.due));
    }

    const check =
      state.mode === 'archived'
        ? ''
        : '<button class="line-check' +
          (goal.status === 'done' ? ' is-checked' : '') +
          '" type="button" data-act="goal-check" aria-pressed="' +
          (goal.status === 'done' ? 'true' : 'false') +
          '" aria-label="' +
          (goal.status === 'done' ? '标记为未完成' : '标记主任务完成') +
          '">✓</button>';

    return (
      '<div class="' +
      classes.join(' ') +
      '" data-kind="goal" data-goal-id="' +
      Util.esc(goal.id) +
      '" data-color="' +
      goal.color +
      '" tabindex="0" role="button" aria-expanded="' +
      (expanded ? 'true' : 'false') +
      '">' +
      '<span class="line-color" aria-hidden="true"></span>' +
      '<button class="line-toggle' +
      (expanded ? ' is-open' : '') +
      '" type="button" data-act="expand" aria-label="' +
      (expanded ? '收起子任务' : '展开子任务') +
      '">▶</button>' +
      '<span class="line-index">' +
      (row.index < 10 ? '0' + row.index : row.index) +
      '</span>' +
      check +
      '<span class="line-title">' +
      Util.esc(goal.title) +
      '</span>' +
      '<span class="line-meta">' +
      Util.esc(metaParts.join(' · ')) +
      '</span>' +
      '<button class="line-more" type="button" data-act="menu" aria-label="更多操作">⋯</button>' +
      '</div>'
    );
  }

  function taskRowHtml(task) {
    const overdue = LL.Tasks.isOverdue(task);
    const classes = ['line', 'line--sub'];
    if (task.done) classes.push('is-done');
    if (overdue) classes.push('is-overdue');

    const meta = overdue
      ? '已逾期 ' + Util.fmtDateTime(task.due)
      : task.due
        ? '截止 ' + Util.fmtDateTime(task.due)
        : '+' + LL.Profile.taskExp(task.estimate) + ' 经验';

    return (
      '<div class="' +
      classes.join(' ') +
      '" data-kind="task" data-task-id="' +
      Util.esc(task.id) +
      '" data-goal-id="' +
      Util.esc(task.goalId) +
      '">' +
      '<button class="line-check' +
      (task.done ? ' is-checked' : '') +
      '" type="button" data-act="task-check" aria-pressed="' +
      (task.done ? 'true' : 'false') +
      '" aria-label="' +
      (task.done ? '标记子任务未完成' : '完成子任务') +
      '">✓</button>' +
      '<span class="line-title">' +
      Util.esc(task.title) +
      '</span>' +
      '<span class="line-meta' +
      (overdue ? ' is-overdue' : task.due ? '' : ' is-exp') +
      '">' +
      Util.esc(meta) +
      '</span>' +
      '<button class="line-more" type="button" data-act="menu" aria-label="子任务操作">⋯</button>' +
      '</div>'
    );
  }

  function hintRowHtml(goal) {
    return (
      '<div class="line line--hint" data-kind="hint">还没有子任务，点这一行右边的「⋯」加一条</div>'
    );
  }

  function addTaskRowHtml(goal) {
    return (
      '<div class="line line--add" data-kind="add-task">' +
      '<button class="line-add-btn" type="button" data-act="add-task" data-goal-id="' +
      Util.esc(goal.id) +
      '">＋ 加一条子任务</button>' +
      '</div>'
    );
  }

  function emptyRowHtml() {
    if (state.mode === 'archived') {
      return (
        '<div class="line line--empty" data-kind="empty">' +
        '<span>归档箱是空的。归档的主任务会躺在这里，随时可以捡回来。</span>' +
        '<button class="line-empty-btn" type="button" data-act="archive-mode">← 回到记事本</button>' +
        '</div>'
      );
    }
    return (
      '<div class="line line--empty" data-kind="empty">' +
      '<span>还没有主任务。先写下一件这学期想完成的事。</span>' +
      '<button class="line-empty-btn" type="button" data-act="new-goal">＋ 写下第一条主任务</button>' +
      '</div>'
    );
  }

  function tasksPageHtml(page) {
    const rows = page.rows.slice();
    const html = [];
    let used = 0;

    if (rows.length === 0) {
      html.push(emptyRowHtml());
      used = 2; // 空状态占两行
    } else {
      if (state.mode === 'archived') {
        html.push(
          '<div class="archive-banner">归档箱 · 共 ' +
            rows.filter((row) => row.kind === 'goal').length +
            ' 个主任务<button type="button" data-act="archive-mode">回到记事本</button></div>'
        );
        used = 1;
      }
      rows.forEach((row) => {
        if (row.kind === 'goal') html.push(goalRowHtml(row));
        else if (row.kind === 'task') html.push(taskRowHtml(row.task));
        else if (row.kind === 'hint') html.push(hintRowHtml(row.goal));
        else if (row.kind === 'add-task') html.push(addTaskRowHtml(row.goal));
        used += 1;
      });
    }

    for (let i = used; i < ROWS; i += 1) html.push('<div class="line is-blank"></div>');

    const taskPageNo = state.page - 1;
    const total = pages.length - 2;
    const title = state.mode === 'archived' ? '归档箱' : '这本记事本';
    const sub =
      state.mode === 'archived'
        ? '共 ' + visibleGoals().length + ' 个'
        : '共 ' + visibleGoals().length + ' 个主任务';

    return (
      '<header class="sheet-head">' +
      '<span class="sheet-title">' +
      title +
      '</span>' +
      '<span class="sheet-sub">' +
      sub +
      ' · 第 ' +
      taskPageNo +
      ' / ' +
      total +
      ' 页</span>' +
      '</header>' +
      '<div class="sheet-body">' +
      html.join('') +
      '</div>' +
      '<footer class="sheet-foot">' +
      '<span>' +
      (currentPageLabel().short || '') +
      '</span>' +
      '<span class="foot-hint">点主任务展开子任务 · 子任务缩进两格</span>' +
      '<span>' +
      (state.mode === 'archived' ? '归档箱' : 'LifeLite') +
      '</span>' +
      '</footer>'
    );
  }

  /* =========================================================================
   * 三、渲染
   * ========================================================================= */
  function currentPageLabel() {
    if (state.page === 0) return { long: '封面', short: '封面' };
    if (state.page === 1) return { long: '扉页', short: '扉页' };
    return {
      long: '第 ' + (state.page - 1) + ' 页 / 共 ' + (pages.length - 2) + ' 页',
      short: '第 ' + (state.page - 1) + ' 页'
    };
  }

  function pageHtml(page) {
    if (page.kind === 'cover') return coverHtml();
    if (page.kind === 'front') return frontHtml();
    return tasksPageHtml(page);
  }

  function updateNav() {
    const indicator = byId('page-indicator');
    const prev = byId('btn-prev');
    const next = byId('btn-next');
    if (indicator) indicator.textContent = currentPageLabel().long;
    if (prev) prev.disabled = state.page === 0;
    if (next) next.disabled = state.page === pages.length - 1;
    const book = byId('book');
    if (book) book.dataset.page = String(state.page);
  }

  function render() {
    rebuildPages();
    const sheet = byId('sheet');
    if (!sheet) return;
    const page = pages[state.page];
    sheet.className =
      'sheet' +
      (page.kind === 'cover' ? ' sheet--cover' : '') +
      (page.kind === 'front' || page.kind === 'tasks' ? ' sheet--ruled' : '');
    sheet.innerHTML = pageHtml(page);
    updateNav();
  }

  /* =========================================================================
   * 四、翻页
   * ========================================================================= */
  function prefersReducedMotion() {
    return Boolean(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function goTo(index) {
    const target = Math.max(0, Math.min(pages.length - 1, index));
    if (target === state.page || state.busy) return;

    if (prefersReducedMotion()) {
      state.page = target;
      render();
      return;
    }

    const forward = target > state.page;
    const flip = byId('flip');
    const sheet = byId('sheet');
    if (!flip || !sheet) {
      state.page = target;
      render();
      return;
    }

    state.busy = true;
    const flipPage = forward ? pages[state.page] : pages[target];
    flip.innerHTML =
      '<article class="sheet' +
      (flipPage.kind === 'cover' ? ' sheet--cover' : ' sheet--ruled') +
      '" aria-hidden="true">' +
      pageHtml(flipPage) +
      '</article>';
    flip.className = 'flip';
    void flip.offsetWidth;
    flip.classList.add(forward ? 'is-forward' : 'is-backward');

    state.page = target;
    render();
    updateNav();

    const cleanup = () => {
      flip.className = 'flip';
      flip.innerHTML = '';
      state.busy = false;
    };
    flip.addEventListener('animationend', cleanup, { once: true });
    global.setTimeout(() => {
      if (state.busy) cleanup();
    }, FLIP_MS + 120);
  }

  function next() {
    goTo(state.page + 1);
  }

  function prev() {
    goTo(state.page - 1);
  }

  /* =========================================================================
   * 五、交互
   * ========================================================================= */
  function toggleExpand(goalId) {
    if (state.expanded[goalId]) delete state.expanded[goalId];
    else state.expanded[goalId] = true;
    render();
  }

  function setMode(mode) {
    state.mode = mode === 'archived' ? 'archived' : 'active';
    state.page = 2; // 直接翻到任务页，不进封面
    render();
  }

  function openMenu(button) {
    const row = button.closest('[data-kind]');
    if (!row) return;
    const menu = byId('line-menu');
    if (!menu) return;

    const isGoal = row.dataset.kind === 'goal';
    const isArchivedRow = state.mode === 'archived';
    const items = [];

    if (isGoal) {
      if (isArchivedRow) {
        items.push(['restore-goal', '恢复到记事本']);
        items.push(['purge-goal', '彻底删除', true]);
      } else {
        items.push(['add-task', '加一条子任务']);
        items.push(['edit-goal', '编辑主任务']);
        items.push(['edit-goal', '归档主任务', false, 'archive-goal']);
        items.push(['delete-goal', '删除主任务', true]);
      }
    } else {
      items.push(['edit-task', '编辑子任务']);
      items.push(['delete-task', '删除子任务', true]);
    }

    const id = isGoal ? row.dataset.goalId : row.dataset.taskId;
    const goalId = isGoal ? row.dataset.goalId : row.dataset.goalId;
    menu.innerHTML = items
      .map((item) => {
        const action = item[3] || item[0];
        const label = item[1];
        const danger = item[2] ? ' is-danger' : '';
        return (
          '<button class="menu-item' +
          danger +
          '" type="button" data-menu-act="' +
          action +
          '" data-id="' +
          Util.esc(id) +
          '" data-goal-id="' +
          Util.esc(goalId) +
          '">' +
          label +
          '</button>'
        );
      })
      .join('');

    menu.hidden = false;
    state.menu = { kind: isGoal ? 'goal' : 'task', id: id, goalId: goalId };
    positionMenu(menu, button);
  }

  function positionMenu(menu, button) {
    const rect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = rect.right - menuRect.width;
    let top = rect.bottom + 6;
    if (top + menuRect.height > global.innerHeight - 8) {
      top = rect.top - menuRect.height - 6;
    }
    left = Math.max(8, Math.min(global.innerWidth - menuRect.width - 8, left));
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  function closeMenu() {
    const menu = byId('line-menu');
    if (menu) {
      menu.hidden = true;
      menu.innerHTML = '';
    }
    state.menu = null;
  }

  function handleGoalCheck(goalId) {
    const goal = LL.Goals.get(goalId);
    if (!goal) return;
    LL.Goals.setStatus(goalId, goal.status === 'done' ? 'active' : 'done');
    render();
  }

  function handleTaskCheck(taskId) {
    LL.Tasks.toggle(taskId);
    render();
  }

  function handleMenuAction(button) {
    const action = button.dataset.menuAct;
    const id = button.dataset.id;
    const goalId = button.dataset.goalId;

    if (action === 'add-task') {
      LL.Tasks.openCreate(goalId);
    } else if (action === 'edit-goal') {
      LL.Goals.openEdit(id);
    } else if (action === 'archive-goal') {
      LL.Goals.setStatus(id, 'archived');
      render();
    } else if (action === 'restore-goal') {
      LL.Goals.setStatus(id, 'active');
      render();
    } else if (action === 'delete-goal') {
      LL.Goals.remove(id).then((result) => {
        if (result && result.ok) render();
      });
    } else if (action === 'purge-goal') {
      LL.Goals.remove(id, { purge: true }).then((result) => {
        if (result && result.ok) render();
        else if (result && result.message) toast(result.message, { tone: 'warn' });
      });
    } else if (action === 'edit-task') {
      LL.Tasks.openEdit(id);
    } else if (action === 'delete-task') {
      LL.Tasks.remove(id).then((result) => {
        if (!result || !result.ok) return;
        render();
        toast('子任务已删除。', {
          tone: 'ok',
          duration: 10000,
          action: {
            label: '撤销',
            onClick() {
              const back = LL.Tasks.restore(result.removed);
              if (back.ok) {
                render();
                toast('子任务已恢复。', { tone: 'ok' });
              } else {
                toast(back.message || '恢复失败，所属主任务可能已被删除。', { tone: 'error' });
              }
            }
          }
        });
      });
    }
  }

  function handleAct(button) {
    const act = button.dataset.act;
    if (act === 'expand') {
      const row = button.closest('[data-kind="goal"]');
      if (row) toggleExpand(row.dataset.goalId);
    } else if (act === 'goal-check') {
      const row = button.closest('[data-kind="goal"]');
      if (row) handleGoalCheck(row.dataset.goalId);
    } else if (act === 'task-check') {
      const row = button.closest('[data-kind="task"]');
      if (row) handleTaskCheck(row.dataset.taskId);
    } else if (act === 'menu') {
      openMenu(button);
    } else if (act === 'add-task') {
      LL.Tasks.openCreate(button.dataset.goalId);
    } else if (act === 'new-goal') {
      LL.Goals.openCreate();
    } else if (act === 'next') {
      next();
    } else if (act === 'prev') {
      prev();
    } else if (act === 'export') {
      if (LL.App && LL.App.exportBackup) LL.App.exportBackup();
    } else if (act === 'import') {
      if (LL.App && LL.App.importBackup) LL.App.importBackup();
    } else if (act === 'checkin') {
      if (LL.App && LL.App.checkin) LL.App.checkin();
    } else if (act === 'archive-mode') {
      setMode(state.mode === 'archived' ? 'active' : 'archived');
    }
  }

  function onSheetClick(event) {
    const actButton = event.target.closest('[data-act]');
    if (actButton) {
      handleAct(actButton);
      return;
    }
    const goalRow = event.target.closest('[data-kind="goal"]');
    if (goalRow) toggleExpand(goalRow.dataset.goalId);
  }

  function onSheetKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-act]')) return;
    const goalRow = event.target.closest('[data-kind="goal"]');
    if (!goalRow) return;
    event.preventDefault();
    toggleExpand(goalRow.dataset.goalId);
  }

  function onDocumentClick(event) {
    const menuButton = event.target.closest('[data-menu-act]');
    if (menuButton) {
      handleMenuAction(menuButton);
      closeMenu();
      return;
    }
    if (!event.target.closest('#line-menu') && !event.target.closest('[data-act="menu"]')) {
      closeMenu();
    }
  }

  function bind() {
    const sheet = byId('sheet');
    if (sheet) {
      sheet.addEventListener('click', onSheetClick);
      sheet.addEventListener('keydown', onSheetKeydown);
    }
    const menu = byId('line-menu');
    if (menu) {
      menu.addEventListener('click', (event) => {
        const item = event.target.closest('[data-menu-act]');
        if (item) {
          handleMenuAction(item);
          closeMenu();
        }
      });
    }
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.target.closest('input, textarea, select')) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        next();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        prev();
      }
    });
    global.addEventListener('resize', () => {
      closeMenu();
    });
    const prevBtn = byId('btn-prev');
    const nextBtn = byId('btn-next');
    if (prevBtn) prevBtn.addEventListener('click', prev);
    if (nextBtn) nextBtn.addEventListener('click', next);
  }

  /* =========================================================================
   * 六、对外接口
   * ========================================================================= */
  LL.Book = {
    ROWS,
    init() {
      bind();
      state.page = 0;
      render();
    },
    render,
    goTo,
    next,
    prev,
    setMode,
    expand(goalId) {
      if (!goalId) return;
      state.expanded[goalId] = true;
      render();
    },
    collapse(goalId) {
      delete state.expanded[goalId];
      render();
    },
    pageCount() {
      return pages.length;
    },
    state
  };
})(typeof window !== 'undefined' ? window : globalThis);


