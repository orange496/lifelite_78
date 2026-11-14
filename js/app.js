/*!
 * app.js — 应用编排
 * ---------------------------------------------------------------------------
 * 职责：
 *   · 初始化数据层与记事本（LL.Book）；
 *   · 全局 Toast、二次确认对话框；
 *   · 三个表单（主任务 / 子任务 / 确认）与导入导出；
 *   · 快捷键（N 新建主任务，翻页键在 book.js 里处理）；
 *   · http(s) 下注册 Service Worker。
 * 依赖：storage.js / profile.js / goals.js / tasks.js / stats.js / book.js。
 */
(function (global) {
  'use strict';

  const LL = (global.LL = global.LL || {});
  const Store = LL.Storage;

  let started = false;
  let resolveConfirm = null;

  function byId(id) {
    return document.getElementById(id);
  }

  /* =========================================================================
   * 一、Toast
   * ========================================================================= */
  const MAX_TOASTS = 3;

  function toast(message, options) {
    const opts = options || {};
    const host = byId('toasts');
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
  function confirm(options) {
    const opts = options || {};
    const dialog = byId('confirm-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') {
      return Promise.resolve(global.confirm((opts.title || '确认操作') + '\n' + (opts.message || '')));
    }
    byId('confirm-title').textContent = opts.title || '确认操作';
    byId('confirm-message').textContent = opts.message || '';
    const okButton = byId('confirm-ok');
    okButton.textContent = opts.okText || '确认';
    okButton.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');

    return new Promise((resolve) => {
      resolveConfirm = resolve;
      dialog.showModal();
      okButton.focus();
    });
  }

  function settleConfirm(value) {
    const dialog = byId('confirm-dialog');
    if (dialog && dialog.open) dialog.close();
    if (resolveConfirm) {
      const resolve = resolveConfirm;
      resolveConfirm = null;
      resolve(value);
    }
  }

  /* =========================================================================
   * 三、刷新与动作
   * ========================================================================= */
  function refresh() {
    if (!started) return;
    LL.Book.render();

    const notice = Store.takeNotice();
    if (notice) {
      toast(notice.message, {
        tone: notice.type === 'error' ? 'error' : 'warn',
        detail: notice.detail || '',
        duration: 5000
      });
    }
  }

  function checkin() {
    const result = LL.Profile.checkin();
    if (!result.ok && result.reason === 'already') {
      toast('今天已经打过卡了。', { tone: 'warn' });
      return;
    }
    if (!result.ok) {
      toast('打卡失败，本地存储可能不可用。', { tone: 'error' });
      return;
    }
    refresh();
    const detail = result.bonus ? '连续打卡奖励 +' + result.bonus + ' 经验。' : '';
    toast('打卡成功，连续 ' + result.streak + ' 天。', { tone: 'ok', detail: detail });
    if (result.leveledUp) {
      toast(LL.Profile.levelUpMessage(LL.Profile.get().level), { tone: 'ok' });
    }
  }

  function exportBackup() {
    const result = Store.downloadExport();
    if (result.ok) toast('已导出备份：' + result.name, { tone: 'ok', duration: 3000 });
    else toast('导出失败。', { tone: 'error' });
  }

  function importBackup() {
    const input = byId('import-file');
    if (input) input.click();
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
          ' 个主任务、' +
          parsed.counts.tasks +
          ' 个子任务，当前记事本会被覆盖（覆盖前会自动备份到 lifelite.backup）。',
        okText: '覆盖导入'
      }).then((ok) => {
        if (!ok) return;
        if (!Store.applyImport(parsed)) {
          toast('导入写入失败，请检查浏览器存储空间。', { tone: 'error' });
          return;
        }
        LL.Book.goTo(0);
        refresh();
        toast('导入完成：' + parsed.counts.goals + ' 个主任务、' + parsed.counts.tasks + ' 个子任务。', {
          tone: 'ok',
          duration: 3000
        });
      });
    };
    reader.onerror = () => toast('读取文件失败。', { tone: 'error' });
    reader.readAsText(file);
  }

  /* =========================================================================
   * 四、事件绑定
   * ========================================================================= */
  function bind() {
    byId('goal-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const result = LL.Goals.submit(event.currentTarget);
      if (result && result.ok && result.goal) {
        LL.Book.expand(result.goal.id);
        LL.Book.goTo(2);
      }
    });

    byId('task-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const result = LL.Tasks.submit(event.currentTarget);
      if (result && result.ok && result.task) LL.Book.expand(result.task.goalId);
    });

    byId('task-estimate').addEventListener('change', LL.Tasks.expHint);

    byId('confirm-form').addEventListener('submit', (event) => {
      event.preventDefault();
      settleConfirm(true);
    });
    byId('confirm-cancel').addEventListener('click', () => settleConfirm(false));
    byId('confirm-dialog').addEventListener('cancel', () => settleConfirm(false));
    byId('confirm-dialog').addEventListener('close', () => {
      if (resolveConfirm) settleConfirm(false);
    });

    document.querySelectorAll('dialog [data-close]').forEach((button) => {
      button.addEventListener('click', () => {
        const dialog = button.closest('dialog');
        if (dialog) dialog.close();
      });
    });

    const importInput = byId('import-file');
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      handleImportFile(file);
    });

    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.target.closest('input, textarea, select')) return;
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        LL.Goals.openCreate();
      }
    });
  }

  /* =========================================================================
   * 五、启动
   * ========================================================================= */
  function registerServiceWorker() {
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

    bind();
    LL.Book.init();
    refresh();

    if (result && result.ok === false) {
      toast(result.message, { tone: 'error', duration: 6000 });
    } else if (result && result.warning) {
      toast(result.warning, { tone: 'warn', duration: 6000 });
    }
    registerServiceWorker();
  }

  LL.ui = { toast, confirm, settleConfirm };
  LL.App = { init, refresh, checkin, exportBackup, importBackup };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
