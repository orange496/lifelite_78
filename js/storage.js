/*!
 * storage.js — LifeLite 数据层
 * ---------------------------------------------------------------------------
 * 职责：localStorage 的读写、版本迁移、导入导出与校验。
 * 约定：
 *   1. 所有写操作都必须经过 write()，由它统一维护 lifelite.meta 的修改时间；
 *   2. 读操作只从存储读取，界面层不得缓存中间状态（见设计决策）；
 *   3. JSON 解析失败时不抛错，回退到空数据并留下原始内容，页面不白屏。
 * 依赖：无。
 */
(function (global) {
  'use strict';

  const LL = (global.LL = global.LL || {});

  /* =========================================================================
   * 一、常量（对应方案附录 A）
   * ========================================================================= */
  const CONST = {
    APP_NAME: 'LifeLite',
    SCHEMA_VERSION: 1,
    EXPORT_VERSION: 1,
    MAX_IMPORT_BYTES: 4 * 1024 * 1024,
    MAX_EXP_LOG: 300,
    COLLAPSE_THRESHOLD: 20,
    GOAL_STATUS: ['active', 'done', 'archived'],
    GOAL_COLORS: ['blue', 'green', 'amber', 'violet', 'slate'],
    PRIORITIES: ['high', 'medium', 'low'],
    ESTIMATES: [15, 30, 60, 90, 120],
    KEYS: {
      goals: 'lifelite.goals',
      tasks: 'lifelite.tasks',
      checkins: 'lifelite.checkins',
      profile: 'lifelite.profile',
      meta: 'lifelite.meta',
      backup: 'lifelite.backup',
      corrupt: 'lifelite.corrupt'
    }
  };

  /* =========================================================================
   * 二、通用工具：日期、转义、id
   * （放在数据层，避免为几个工具函数再拆一个文件）
   * ========================================================================= */
  const DAY = 24 * 60 * 60 * 1000;

  const Util = {
    pad(n) {
      return String(n).padStart(2, '0');
    },

    /** Date → 'YYYY-MM-DD'（本地时区） */
    toDateStr(date) {
      return (
        date.getFullYear() +
        '-' +
        Util.pad(date.getMonth() + 1) +
        '-' +
        Util.pad(date.getDate())
      );
    },

    /** 今天的 'YYYY-MM-DD'（本地时区，打卡与统计的唯一日期基准） */
    todayStr() {
      return Util.toDateStr(new Date());
    },

    /** 当前时间的带时区 ISO 字符串，例如 2026-11-03T21:10:00+08:00 */
    nowISO(date) {
      const d = date || new Date();
      const offset = -d.getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      return (
        Util.toDateStr(d) +
        'T' +
        Util.pad(d.getHours()) +
        ':' +
        Util.pad(d.getMinutes()) +
        ':' +
        Util.pad(d.getSeconds()) +
        sign +
        Util.pad(Math.floor(abs / 60)) +
        ':' +
        Util.pad(abs % 60)
      );
    },

    /** 'YYYY-MM-DD' → 本地零点的 Date；非法输入返回 null */
    parseDay(dateStr) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
      if (!m) return null;
      const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (Number.isNaN(date.getTime())) return null;
      return date;
    },

    /** 'YYYY-MM-DD' 加 n 天 */
    addDays(dateStr, n) {
      const date = Util.parseDay(dateStr);
      if (!date) return dateStr;
      date.setDate(date.getDate() + n);
      return Util.toDateStr(date);
    },

    /** 本周一（周一为一周起点）零点的 Date */
    startOfWeek(date) {
      const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const offset = (d.getDay() + 6) % 7; // 周一 = 0
      d.setDate(d.getDate() - offset);
      return d;
    },

    isPastDay(dateStr) {
      const today = Util.todayStr();
      return Boolean(dateStr) && String(dateStr).slice(0, 10) < today;
    },

    /** 12月20日 / 2027年1月3日 */
    fmtDue(value) {
      if (!value) return '';
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
      if (!m) return '';
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const nowYear = new Date().getFullYear();
      return year === nowYear
        ? month + '月' + day + '日'
        : year + '年' + month + '月' + day + '日';
    },

    /** 带时区的 ISO → 12-20 22:00 */
    fmtDateTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return (
        Util.pad(date.getMonth() + 1) +
        '-' +
        Util.pad(date.getDate()) +
        ' ' +
        Util.pad(date.getHours()) +
        ':' +
        Util.pad(date.getMinutes())
      );
    },

    /** 单个汉字的星期标签 */
    weekdayLabel(value) {
      const date = Util.parseDay(String(value || '').slice(0, 10));
      if (!date) return '';
      return '一二三四五六日'[((date.getDay() + 6) % 7)];
    },

    /** 生成 g_1a2b3c / t_4d5e6f 形式的 id */
    uid(prefix) {
      const stamp = Date.now().toString(36).slice(-4);
      const rand = Math.random().toString(36).slice(2, 6);
      return prefix + '_' + stamp + rand;
    },

    /** HTML 转义，渲染用户输入前必须调用 */
    esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
        switch (ch) {
          case '&':
            return '&amp;';
          case '<':
            return '&lt;';
          case '>':
            return '&gt;';
          case '"':
            return '&quot;';
          default:
            return '&#39;';
        }
      });
    },

    /** 去首尾空格并按上限截断 */
    clip(value, max) {
      const text = String(value == null ? '' : value).trim();
      return max && text.length > max ? text.slice(0, max) : text;
    },

    clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    },

    toInt(value, fallback) {
      const n = parseInt(value, 10);
      return Number.isFinite(n) ? n : fallback;
    }
  };

  /* =========================================================================
   * 三、数据层内部状态
   * ========================================================================= */
  const KEYS = CONST.KEYS;
  let storageOK = true;
  let notice = null; // 一次性的提示，由界面层取走

  function dayIsValid(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function defaults(name) {
    switch (name) {
      case 'goals':
        return [];
      case 'tasks':
        return [];
      case 'checkins':
        return {};
      case 'profile':
        return {
          exp: 0,
          level: 1,
          streak: 0,
          lastCheckin: null,
          streakBonusCount: 0,
          expLog: []
        };
      case 'meta':
        return { schemaVersion: CONST.SCHEMA_VERSION, lastModified: null, lastWrite: null };
      case 'backup':
        return null;
      default:
        return null;
    }
  }

  /* ------------------------- 底层读写 ------------------------- */
  function rawRead(name) {
    try {
      return global.localStorage.getItem(KEYS[name]);
    } catch (err) {
      storageOK = false;
      notice = {
        type: 'error',
        message: '浏览器禁止读取本地存储，本次改动无法保存。'
      };
      return null;
    }
  }

  function rawWrite(name, text) {
    try {
      global.localStorage.setItem(KEYS[name], text);
      storageOK = true;
      return true;
    } catch (err) {
      storageOK = false;
      notice = {
        type: 'error',
        message: '本地存储写入失败，可能是空间不足或浏览器限制。',
        detail: String((err && err.message) || err)
      };
      return false;
    }
  }

  function rawRemove(name) {
    try {
      global.localStorage.removeItem(KEYS[name]);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** 损坏数据不丢弃：留档到 lifelite.corrupt，便于排查与手工恢复 */
  function preserveCorrupt(name, raw, err) {
    let payload = {};
    const existing = rawRead('corrupt');
    if (existing) {
      try {
        payload = JSON.parse(existing) || {};
      } catch (parseErr) {
        payload = {};
      }
    }
    payload[name] = {
      at: Util.nowISO(),
      length: raw.length,
      error: String((err && err.message) || err),
      raw: raw.slice(0, 20000)
    };
    rawWrite('corrupt', JSON.stringify(payload));
    notice = {
      type: 'error',
      message: '本地数据损坏，已回退到空数据。',
      detail: '原始内容已留档到 lifelite.corrupt 键，可用导出备份排查。'
    };
  }

  /* ------------------------- 规范化 ------------------------- */
  function coerceGoal(rawGoal) {
    const goal = rawGoal || {};
    return {
      id: String(goal.id),
      title: Util.clip(goal.title, 60),
      desc: Util.clip(goal.desc, 300),
      due: dayIsValid(goal.due) ? goal.due : null,
      color: CONST.GOAL_COLORS.indexOf(goal.color) >= 0 ? goal.color : 'blue',
      status: CONST.GOAL_STATUS.indexOf(goal.status) >= 0 ? goal.status : 'active',
      createdAt: typeof goal.createdAt === 'string' && goal.createdAt ? goal.createdAt : Util.nowISO()
    };
  }

  function coerceTask(rawTask) {
    const task = rawTask || {};
    const estimate = CONST.ESTIMATES.indexOf(Number(task.estimate)) >= 0 ? Number(task.estimate) : null;
    const done = Boolean(task.done);
    let completedAt = done && typeof task.completedAt === 'string' && task.completedAt ? task.completedAt : null;
    if (done && !completedAt) completedAt = Util.nowISO();
    if (!done) completedAt = null;
    return {
      id: String(task.id),
      goalId: String(task.goalId),
      title: Util.clip(task.title, 80),
      priority: CONST.PRIORITIES.indexOf(task.priority) >= 0 ? task.priority : 'medium',
      estimate: estimate,
      due: typeof task.due === 'string' && task.due ? task.due : null,
      done: done,
      completedAt: completedAt,
      createdAt: typeof task.createdAt === 'string' && task.createdAt ? task.createdAt : Util.nowISO()
    };
  }

  function coerceCheckins(rawCheckins) {
    const result = {};
    if (!rawCheckins || typeof rawCheckins !== 'object') return result;
    Object.keys(rawCheckins).forEach((key) => {
      if (dayIsValid(key) && rawCheckins[key]) result[key] = true;
    });
    return result;
  }

  function coerceProfile(rawProfile) {
    const base = defaults('profile');
    const profile = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
    const log = Array.isArray(profile.expLog) ? profile.expLog : [];
    base.exp = Math.max(0, Util.toInt(profile.exp, 0));
    base.level = Math.max(1, Util.toInt(profile.level, 1));
    base.streak = Math.max(0, Util.toInt(profile.streak, 0));
    base.lastCheckin = dayIsValid(profile.lastCheckin) ? profile.lastCheckin : null;
    base.streakBonusCount = Math.max(0, Util.toInt(profile.streakBonusCount, 0));
    base.expLog = log
      .filter((entry) => entry && typeof entry === 'object' && Number.isFinite(Number(entry.amount)))
      .slice(-CONST.MAX_EXP_LOG)
      .map((entry) => ({
        at: typeof entry.at === 'string' ? entry.at : Util.nowISO(),
        amount: Util.toInt(entry.amount, 0),
        source: typeof entry.source === 'string' ? entry.source : 'unknown',
        refId: entry.refId == null ? null : String(entry.refId)
      }));
    return base;
  }

  function coerceMeta(rawMeta) {
    const meta = rawMeta && typeof rawMeta === 'object' ? rawMeta : {};
    return {
      schemaVersion: Util.toInt(meta.schemaVersion, CONST.SCHEMA_VERSION),
      lastModified: typeof meta.lastModified === 'string' ? meta.lastModified : null,
      lastWrite: typeof meta.lastWrite === 'string' ? meta.lastWrite : null
    };
  }

  function normalize(name, value) {
    switch (name) {
      case 'goals':
        return Array.isArray(value)
          ? value.filter((item) => item && typeof item === 'object' && item.id && item.title).map(coerceGoal)
          : defaults('goals');
      case 'tasks':
        return Array.isArray(value)
          ? value
              .filter((item) => item && typeof item === 'object' && item.id && item.goalId && item.title)
              .map(coerceTask)
          : defaults('tasks');
      case 'checkins':
        return coerceCheckins(value);
      case 'profile':
        return coerceProfile(value);
      case 'meta':
        return coerceMeta(value);
      default:
        return value;
    }
  }

  /* =========================================================================
   * 四、公开读写接口
   * ========================================================================= */
  function read(name) {
    const raw = rawRead(name);
    if (raw === null || raw === '') return defaults(name);
    let value;
    try {
      value = JSON.parse(raw);
    } catch (err) {
      preserveCorrupt(name, raw, err);
      return defaults(name);
    }
    return normalize(name, value);
  }

  function touchMeta(lastWrite) {
    rawWrite(
      'meta',
      JSON.stringify({
        schemaVersion: CONST.SCHEMA_VERSION,
        lastModified: Util.nowISO(),
        lastWrite: lastWrite || null
      })
    );
  }

  /** 唯一的写入口：序列化 → 落盘 → 更新 meta */
  function write(name, value) {
    let text;
    try {
      text = JSON.stringify(value);
    } catch (err) {
      notice = { type: 'error', message: '数据无法序列化，写入已取消。' };
      return false;
    }
    if (!rawWrite(name, text)) return false;
    touchMeta(name);
    return true;
  }

  function remove(name) {
    const ok = rawRemove(name);
    if (ok) touchMeta(name);
    return ok;
  }

  /* =========================================================================
   * 五、初始化与版本迁移
   * ========================================================================= */
  function migrate(fromVersion) {
    // 迁移表：键为起始版本，值是把它升到「键 + 1」的函数。
    // 当前只有 v1，暂无迁移步骤；新增版本时在此登记，不要删旧步骤。
    const steps = {};

    for (let version = fromVersion; version < CONST.SCHEMA_VERSION; version += 1) {
      const step = steps[version];
      if (typeof step !== 'function') {
        return { ok: false, message: '缺少从版本 ' + version + ' 升级的迁移步骤，已放弃读取。' };
      }
      try {
        step();
      } catch (err) {
        return { ok: false, message: '数据迁移失败：' + ((err && err.message) || err) };
      }
    }
    touchMeta('migrate');
    return { ok: true };
  }

  function init() {
    try {
      const probe = '__lifelite_probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      storageOK = true;
    } catch (err) {
      storageOK = false;
      return {
        ok: false,
        message: '当前浏览器不允许本地存储（无痕模式或禁用了站点数据），页面可用但数据不会保存。'
      };
    }

    const meta = read('meta');
    if (meta.schemaVersion > CONST.SCHEMA_VERSION) {
      return {
        ok: true,
        warning:
          '本地数据来自更高版本的程序（schemaVersion ' +
          meta.schemaVersion +
          '），已按当前版本读取，建议更新页面。'
      };
    }
    if (meta.schemaVersion < CONST.SCHEMA_VERSION) {
      const result = migrate(meta.schemaVersion);
      if (!result.ok) return { ok: false, message: result.message };
    }
    if (rawRead('meta') === null) touchMeta('init');
    return { ok: true };
  }

  /* =========================================================================
   * 六、校验（导入时使用；单条不合法则整体拒绝）
   * ========================================================================= */
  function validateGoal(goal) {
    if (!goal || typeof goal !== 'object' || Array.isArray(goal)) return '不是对象';
    if (!goal.id || typeof goal.id !== 'string') return '缺少 id';
    if (typeof goal.title !== 'string' || !goal.title.trim()) return '缺少名称';
    if (goal.title.trim().length > 60) return '名称超过 60 字';
    if (goal.desc != null && typeof goal.desc !== 'string') return '描述不是文本';
    if (goal.desc && goal.desc.length > 300) return '描述超过 300 字';
    if (goal.due != null && goal.due !== '' && !dayIsValid(goal.due)) return '截止日期不是 YYYY-MM-DD';
    if (goal.color != null && CONST.GOAL_COLORS.indexOf(goal.color) < 0) return '颜色标签不在预设范围内';
    if (goal.status != null && CONST.GOAL_STATUS.indexOf(goal.status) < 0) return '状态不在 active/done/archived 内';
    return null;
  }

  function validateTask(task) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return '不是对象';
    if (!task.id || typeof task.id !== 'string') return '缺少 id';
    if (!task.goalId || typeof task.goalId !== 'string') return '缺少 goalId';
    if (typeof task.title !== 'string' || !task.title.trim()) return '缺少标题';
    if (task.title.trim().length > 80) return '标题超过 80 字';
    if (task.priority != null && CONST.PRIORITIES.indexOf(task.priority) < 0) return '优先级不在 high/medium/low 内';
    if (task.estimate != null && task.estimate !== '' && CONST.ESTIMATES.indexOf(Number(task.estimate)) < 0) {
      return '预计时长不在 15/30/60/90/120 内';
    }
    if (typeof task.done !== 'boolean') return 'done 必须是布尔值';
    if (task.due != null && task.due !== '' && Number.isNaN(Date.parse(task.due))) return '截止时间无法解析';
    return null;
  }

  /* =========================================================================
   * 七、导入与导出
   * ========================================================================= */
  function buildExport() {
    return {
      app: CONST.APP_NAME,
      version: CONST.EXPORT_VERSION,
      schemaVersion: CONST.SCHEMA_VERSION,
      exportedAt: Util.nowISO(),
      goals: read('goals'),
      tasks: read('tasks'),
      checkins: read('checkins'),
      profile: read('profile')
    };
  }

  function exportText() {
    return JSON.stringify(buildExport(), null, 2);
  }

  function exportFileName() {
    return 'lifelite-backup-' + Util.todayStr().replace(/-/g, '') + '.json';
  }

  /** 触发浏览器下载，返回文件名与字节数 */
  function downloadExport() {
    const text = exportText();
    const name = exportFileName();
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
      return { ok: false, name, bytes: text.length, text: text };
    }
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true, name, bytes: text.length };
  }

  const FAIL_MESSAGE = '文件格式不对，需要 LifeLite 导出的备份文件。';

  function importFail(reason) {
    return { ok: false, message: FAIL_MESSAGE, reason: reason };
  }

  /**
   * 解析并校验备份文件，不写存储。
   * 返回 { ok:true, goals, tasks, checkins, profile, counts } 或 { ok:false, message, reason }
   */
  function importText(text) {
    if (typeof text !== 'string' || !text.trim()) return importFail('文件是空的。');
    if (text.length > CONST.MAX_IMPORT_BYTES) {
      return importFail('文件超过 4 MB 上限，已拒绝。');
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return importFail('不是合法的 JSON。');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return importFail('顶层结构不是对象。');
    }
    if (!Object.prototype.hasOwnProperty.call(data, 'version')) {
      return importFail('缺少 version 字段，可能不是 LifeLite 的备份。');
    }
    if (typeof data.version !== 'number' || !Number.isFinite(data.version)) {
      return importFail('version 字段必须是数字。');
    }
    if (data.version > CONST.EXPORT_VERSION) {
      return importFail('备份版本 ' + data.version + ' 高于当前程序支持的 ' + CONST.EXPORT_VERSION + '。');
    }
    if (!Array.isArray(data.goals)) return importFail('goals 必须是数组。');
    if (!Array.isArray(data.tasks)) return importFail('tasks 必须是数组。');

    const goals = [];
    const goalIds = Object.create(null);
    for (let i = 0; i < data.goals.length; i += 1) {
      const goal = data.goals[i];
      const error = validateGoal(goal);
      if (error) return importFail('第 ' + (i + 1) + ' 个目标：' + error + '。');
      if (goalIds[goal.id]) return importFail('目标 id 重复：' + goal.id + '。');
      goalIds[goal.id] = true;
      goals.push(coerceGoal(goal));
    }

    const tasks = [];
    const taskIds = Object.create(null);
    for (let i = 0; i < data.tasks.length; i += 1) {
      const task = data.tasks[i];
      const error = validateTask(task);
      if (error) return importFail('第 ' + (i + 1) + ' 个任务：' + error + '。');
      if (taskIds[task.id]) return importFail('任务 id 重复：' + task.id + '。');
      if (!goalIds[task.goalId]) {
        return importFail('任务「' + task.title + '」指向不存在的目标，属于脏数据。');
      }
      taskIds[task.id] = true;
      tasks.push(coerceTask(task));
    }

    let checkins = {};
    if (data.checkins != null) {
      if (typeof data.checkins !== 'object' || Array.isArray(data.checkins)) {
        return importFail('checkins 必须是对象。');
      }
      const keys = Object.keys(data.checkins);
      for (let i = 0; i < keys.length; i += 1) {
        if (!dayIsValid(keys[i])) return importFail('打卡记录的日期格式不对：' + keys[i] + '。');
      }
      checkins = coerceCheckins(data.checkins);
    }

    const profile = data.profile ? coerceProfile(data.profile) : defaults('profile');

    return {
      ok: true,
      goals: goals,
      tasks: tasks,
      checkins: checkins,
      profile: profile,
      counts: {
        goals: goals.length,
        tasks: tasks.length,
        checkins: Object.keys(checkins).length
      }
    };
  }

  /** 覆盖当前数据：先把旧数据存进备份键，再逐键写入 */
  function applyImport(parsed) {
    if (!parsed || !parsed.ok) return false;
    const snapshot = { kind: 'import', at: Util.nowISO(), data: buildExport() };
    rawWrite('backup', JSON.stringify(snapshot));
    const a = write('goals', parsed.goals);
    const b = write('tasks', parsed.tasks);
    const c = write('checkins', parsed.checkins);
    const d = write('profile', parsed.profile);
    return a && b && c && d;
  }

  /* =========================================================================
   * 八、对外导出
   * ========================================================================= */
  const Storage = {
    CONST: CONST,
    Util: Util,
    keys: KEYS,

    init,
    migrate,
    isAvailable() {
      return storageOK;
    },
    takeNotice() {
      const current = notice;
      notice = null;
      return current;
    },

    read,
    write,
    remove,

    readGoals() {
      return read('goals');
    },
    writeGoals(goals) {
      return write('goals', Array.isArray(goals) ? goals : []);
    },
    readTasks() {
      return read('tasks');
    },
    writeTasks(tasks) {
      return write('tasks', Array.isArray(tasks) ? tasks : []);
    },
    readCheckins() {
      return read('checkins');
    },
    writeCheckins(checkins) {
      return write('checkins', checkins || {});
    },
    readProfile() {
      return read('profile');
    },
    writeProfile(profile) {
      return write('profile', profile || defaults('profile'));
    },
    readMeta() {
      return read('meta');
    },

    buildExport,
    exportText,
    exportFileName,
    downloadExport,
    importText,
    applyImport,
    validateGoal,
    validateTask,
    coerceGoal,
    coerceTask
  };

  LL.CONST = CONST;
  LL.Util = Util;
  LL.Storage = Storage;
})(typeof window !== 'undefined' ? window : globalThis);
