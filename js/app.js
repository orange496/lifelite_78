/*!
 * app.js — 界面编排与可用性（F8）
 * ---------------------------------------------------------------------------
 * 职责：
 *   · 初始化数据层、渲染所有视图；
 *   · 统一绑定事件（按钮、卡片操作、弹窗提交、快捷键、导入导出）；
 *   · 提供全局 Toast 与二次确认对话框；
 *   · 响应式视图切换（<640px 时在目标栏与任务栏之间切换）；
 *   · 在 http(s) 下注册 Service Worker（file:// 双击打开时自动跳过）。
 * 依赖：storage.js / profile.js / goals.js / tasks.js / stats.js。
 */
(function (global) {
  'use strict';

  const LL = (global.LL = global.LL || {});
  const Store = LL.Storage;

  let started = false;
  let resolveConfirm = null;
  const MOBILE_QUERY = '(max-width: 639px)';

  /* =========================================================================
   * 一、Toast
   * ========================================================================= */
  const MAX_TOASTS = 3;

  /**
   * 右下角提示，默认 2 秒消失；带 action 时停留 10 秒（用于「撤销」）。
   */
  function toast(message, options) {
    const opts = options || {};
    const host = document.getElementById('toasts');
    if (!host) return { close() {} };

    while (host.childElementCount >= MAX_TOASTS) {
      host.removeChild(host.firstElementChild);
    }

    const node = document.createElement('div');
    node.className = 'toast' + (opts.tone ? ' is-' + opts.tone : '');

    const text = document.createElement('div');
    text.className = 'toast-text';
    const main = document.createElement('span');
    main.textContent = message;
    text.appendChild(main);
    if (opts.detail) {
      const detail = document.createElement('span');
      detail.className = 'toast-detail';
      detail.textContent = opts.detail;
      text.appendChild(detail);
    }
    node.appendChild(text);

    let timer = null;
    let closed = false;

    function close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      node.classList.add('is-out');
      setTimeout(() => {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 200);
    }

    if (opts.action && typeof opts.action.onClick === 'function') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = opts.action.label || '撤销';
      button.addEventListener('click', () => {
        close();
        opts.action.onClick();
      });
      node.appendChild(button);
    }

    host.appendChild(node);
    timer = setTimeout(close, opts.duration != null ? opts.duration : opts.action ? 10000 : 2000);
    return { close, node };
  }

  /* =========================================================================
   * 二、二次确认
   * ========================================================================= */
  /**
   * 弹出确认框，返回 Promise<boolean>。
   * @param {{title?:string, message?:string, okText?:string, danger?:boolean}} options
   */
  function confirm(options) {
    const opts = options || {};
    const dialog = document.getElementById('confirm-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') {
      // 极老的浏览器没有 <dialog>：退回原生 confirm，保证删除逻辑仍可用
      return Promise.resolve(global.confirm((opts.title || '确认操作') + '\n' + (opts.message || '')));
    }
    document.getElementById('confirm-title').textContent = opts.title || '确认操作';
    document.getElementById('confirm-message').textContent = opts.message || '';
    const okButton = document.getElementById('confirm-ok');
    okButton.textContent = opts.okText || '确认';
    okButton.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');

    return new Promise((resolve) => {
      resolveConfirm = resolve;
      dialog.showModal();
      okButton.focus();
    });
  }

  function settleConfirm(value) {
    const dialog = document.getElementById('confirm-dialog');
    if (dialog && dialog.open) dialog.close();
    if (resolveConfirm) {
      const resolve = resolveConfirm;
      resolveConfirm = null;
      resolve(value);
    }
  }

  /* =========================================================================
   * 三、渲染编排
   * ========================================================================= */
  function refresh(options) {
    if (!started) return;
    LL.Profile.render(options);
    LL.Stats.render();
    LL.Goals.render();
    LL.Tasks.render();
    syncMobileMode();

    const notice = Store.takeNotice();
    if (notice) {
      toast(notice.message, {
        tone: notice.type === 'error' ? 'error' : 'warn',
        detail: notice.detail || '',
        duration: 5000
      });
    }
  }

  function isMobile() {
    return Boolean(global.matchMedia && global.matchMedia(MOBILE_QUERY).matches);
  }

  /** <640px 时只显示当前视图：选中目标后切到任务栏，返回时切回目标栏 */
  function syncMobileMode() {
    if (!isMobile() || !LL.Goals.selectedId()) {
      document.body.classList.remove('mode-tasks');
      return;
    }
  }

  function showTasksPane() {
    document.body.classList.add('mode-tasks');
    const title = document.getElementById('selected-goal-title');
    if (title) title.focus({ preventScroll: true });
  }

  function showGoalsPane() {
    document.body.classList.remove('mode-tasks');
    const selected = document.querySelector('#goal-list .goal-card.is-selected');
    if (selected) selected.focus({ preventScroll: true });
  }

  function focusGoalCard(id) {
    const card = document.querySelector('#goal-list [data-goal-id="' + id + '"]');
    if (!card) return;
    card.focus({ preventScroll: false });
    card.scrollIntoView({ block: 'nearest' });
  }

  /* =========================================================================
   * 四、事件：目标与任务
   * ========================================================================= */
  function openNewTask() {
    if (LL.Goals.list().length === 0) {
      toast('先新建一个目标，再往里面拆任务。', { tone: 'warn' });
      LL.Goals.openCreate();
      return;
    }
    LL.Tasks.openCreate(LL.Goals.selectedId());
  }

  function handleGoalListClick(event) {
    const actionButton = event.target.closest('[data-act]');
    const card = event.target.closest('[data-goal-id]');
    if (!card) return;
    const id = card.dataset.goalId;

    if (!actionButton) {
      LL.Goals.select(id);
      refresh();
      if (isMobile()) showTasksPane();
      return;
    }

    const action = actionButton.dataset.act;
    if (action === 'edit') {
      LL.Goals.openEdit(id);
    } else if (action === 'done') {
      LL.Goals.setStatus(id, 'done');
      refresh();
    } else if (action === 'reopen') {
      LL.Goals.setStatus(id, 'active');
      refresh();
    } else if (action === 'archive') {
      LL.Goals.setStatus(id, 'archived');
      refresh();
    } else if (action === 'unarchive') {
      LL.Goals.setStatus(id, 'active');
      refresh();
    } else if (action === 'delete' || action === 'purge') {
      LL.Goals.remove(id, { purge: action === 'purge' }).then((result) => {
        if (result && result.ok) refresh();
        else if (result && result.message) toast(result.message, { tone: 'warn' });
      });
    }
  }

  function handleGoalListKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-act]')) return; // 让按钮自己处理
    const card = event.target.closest('[data-goal-id]');
    if (!card) return;
    event.preventDefault();
    LL.Goals.select(card.dataset.goalId);
    refresh();
    if (isMobile()) showTasksPane();
  }

  function handleTaskListClick(event) {
    if (event.target.closest('[data-act="collapse"]')) {
      const goalId = LL.Goals.selectedId();
      if (goalId) LL.Tasks.toggleCollapse(goalId, LL.Tasks.listOf(goalId).length);
      return;
    }

    const row = event.target.closest('[data-task-id]');
    const actionButton = event.target.closest('[data-act]');
    if (!row || !actionButton) return;
    const id = row.dataset.taskId;
    const action = actionButton.dataset.act;

    if (action === 'toggle') {
      LL.Tasks.toggle(id);
    } else if (action === 'edit') {
      LL.Tasks.openEdit(id);
    } else if (action === 'delete') {
      LL.Tasks.remove(id).then((result) => {
        if (!result || !result.ok) return;
        refresh();
        toast('任务已删除。', {
          tone: 'ok',
          duration: 10000,
          action: {
            label: '撤销',
            onClick() {
              const back = LL.Tasks.restore(result.removed);
              if (back.ok) toast('任务已恢复。', { tone: 'ok' });
              else toast(back.message || '恢复失败，所属目标可能已被删除。', { tone: 'error' });
            }
          }
        });
      });
    }
  }

  /* =========================================================================
   * 五、事件：表单、导入导出、快捷键
   * ========================================================================= */
  function handleCheckin() {
    const result = LL.Profile.checkin();
    if (!result.ok && result.reason === 'already') {
      toast('今天已经打过卡了。', { tone: 'warn' });
      return;
    }
    if (!result.ok) {
      toast('打卡失败，本地存储可能不可用。', { tone: 'error' });
      return;
    }

    refresh({ leveledUp: result.leveledUp });
    const detail = result.bonus ? '连续打卡奖励 +' + result.bonus + ' 经验。' : '';
    toast('打卡成功，连续 ' + result.streak + ' 天。', { tone: 'ok', detail: detail });
    if (result.leveledUp) {
      toast(LL.Profile.levelUpMessage(LL.Profile.get().level), { tone: 'ok' });
    }
  }

  function handleExport() {
    const result = Store.downloadExport();
    if (result.ok) toast('已导出备份：' + result.name, { tone: 'ok', duration: 3000 });
    else toast('导出失败。', { tone: 'error' });
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = Store.importText(String(reader.result || ''));
      if (!parsed.ok) {
        toast(parsed.message, { tone: 'error', detail: parsed.reason || '', duration: 5000 });
        return;
      }
      confirm({
        title: '导入备份',
        message:
          '将导入 ' +
          parsed.counts.goals +
          ' 个目标、' +
          parsed.counts.tasks +
          ' 个任务，当前数据会被覆盖（覆盖前会自动备份到 lifelite.backup）。',
        okText: '覆盖导入'
      }).then((ok) => {
        if (!ok) return;
        if (!Store.applyImport(parsed)) {
          toast('导入写入失败，请检查浏览器存储空间。', { tone: 'error' });
          return;
        }
        LL.Goals.select(null);
        refresh();
        toast('导入完成：' + parsed.counts.goals + ' 个目标、' + parsed.counts.tasks + ' 个任务。', {
          tone: 'ok',
          duration: 3000
        });
      });
    };
    reader.onerror = () => toast('读取文件失败。', { tone: 'error' });
    reader.readAsText(file);
  }

  function handleShortcut(event) {
    if (event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    const target = event.target;
    const typing =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    if (typing) return;

    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      LL.Goals.openCreate();
    } else if (event.key === 't' || event.key === 'T') {
      event.preventDefault();
      openNewTask();
    }
  }

  function bindEvents() {
    document.getElementById('btn-new-goal').addEventListener('click', () => LL.Goals.openCreate());
    document.getElementById('btn-empty-new-goal').addEventListener('click', () => LL.Goals.openCreate());
    document.getElementById('btn-new-task').addEventListener('click', openNewTask);
    document.getElementById('btn-empty-new-task').addEventListener('click', (event) => {
      const mode = event.currentTarget.getAttribute('data-mode');
      if (mode === 'no-goals') LL.Goals.openCreate();
      else openNewTask();
    });
    document.getElementById('btn-checkin').addEventListener('click', handleCheckin);
    document.getElementById('btn-back').addEventListener('click', showGoalsPane);

    document.getElementById('goal-list').addEventListener('click', handleGoalListClick);
    document.getElementById('goal-list').addEventListener('keydown', handleGoalListKeydown);
    document.getElementById('task-list').addEventListener('click', handleTaskListClick);

    document.querySelectorAll('.goal-tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        LL.Goals.setView(tab.dataset.view);
        refresh();
      });
    });

    document.getElementById('goal-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const result = LL.Goals.submit(event.currentTarget);
      if (result && result.ok && result.goal) focusGoalCard(result.goal.id);
    });

    document.getElementById('task-form').addEventListener('submit', (event) => {
      event.preventDefault();
      LL.Tasks.submit(event.currentTarget);
    });

    document.getElementById('task-estimate').addEventListener('change', LL.Tasks.expHint);

    document.getElementById('confirm-form').addEventListener('submit', (event) => {
      event.preventDefault();
      settleConfirm(true);
    });
    document.getElementById('confirm-cancel').addEventListener('click', () => settleConfirm(false));
    document.getElementById('confirm-dialog').addEventListener('cancel', () => settleConfirm(false));
    document.getElementById('confirm-dialog').addEventListener('close', () => {
      if (resolveConfirm) settleConfirm(false);
    });

    document.querySelectorAll('dialog [data-close]').forEach((button) => {
      button.addEventListener('click', () => {
        const dialog = button.closest('dialog');
        if (dialog) dialog.close();
      });
    });

    document.getElementById('btn-export').addEventListener('click', handleExport);
    const importButton = document.getElementById('btn-import');
    const importInput = document.getElementById('import-file');
    importButton.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      handleImportFile(file);
    });

    document.addEventListener('keydown', handleShortcut);
    if (global.matchMedia) {
      const query = global.matchMedia(MOBILE_QUERY);
      if (typeof query.addEventListener === 'function') query.addEventListener('change', syncMobileMode);
    }
  }

  /* =========================================================================
   * 六、启动
   * ========================================================================= */
  function registerServiceWorker() {
    // Service Worker 只在 http(s) 下可用；双击 index.html（file://）时安静跳过
    if (!('serviceWorker' in navigator)) return;
    if (global.location && global.location.protocol === 'file:') return;
    global.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        if (global.console) global.console.warn('[LifeLite] Service Worker 注册失败：', err);
      });
    });
  }

  function init() {
    if (started) return;
    const result = Store.init();
    started = true;

    bindEvents();
    refresh();

    if (result && result.ok === false) {
      toast(result.message, { tone: 'error', duration: 6000 });
    } else if (result && result.warning) {
      toast(result.warning, { tone: 'warn', duration: 6000 });
    }
    registerServiceWorker();
  }

  LL.ui = { toast, confirm, settleConfirm };
  LL.App = { init, refresh, showTasksPane, showGoalsPane, focusGoalCard };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
