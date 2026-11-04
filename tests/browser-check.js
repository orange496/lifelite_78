/*
 * 真实浏览器验收脚本（可选，需要 Node 18+ 与本机 Chrome/Edge）
 *
 * 用途：在真实 Chrome 里跑响应式、交互、Service Worker 离线与 file:// 双击场景，
 * 并顺便生成 docs/screenshots/ 下的截图。它不参与应用运行，应用本身依然零依赖。
 *
 * 准备：
 *   npm i puppeteer-core --no-save     # 只装测试用的浏览器驱动
 *   node tests/browser-check.js        # 可用 CHROME_PATH 指定浏览器
 *
 * 说明：脚本会自己起一个本地静态服务器（随机端口），结束后关闭。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');

function loadPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch (e) {
    console.error('未找到 puppeteer-core。请先执行：npm i puppeteer-core --no-save');
    process.exit(2);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// 示例数据：3 个目标、6 个任务、近 10 天打卡。日期全部相对「今天」生成。
function demoDataScript() {
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const iso = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };
  const goals = [
    { id: 'g_demo0001', title: '通过大学英语六级', desc: '每天 30 分钟听力，周末集中做套题。', due: day(46), color: 'green', status: 'active', createdAt: iso(-6) },
    { id: 'g_demo0002', title: '完成开源文化期末项目', desc: '把 LifeLite 交付到 GitHub，并准备好演示。', due: day(4), color: 'violet', status: 'active', createdAt: iso(-5) },
    { id: 'g_demo0003', title: '每周跑三次步', desc: '不追求配速，先把频率稳住。', due: '', color: 'amber', status: 'active', createdAt: iso(-4) }
  ];
  const tasks = [
    { id: 't_demo0001', goalId: 'g_demo0001', title: '精听一套真题听力', priority: 'high', estimate: 60, due: day(-1) + 'T21:00', done: true, completedAt: iso(-1), createdAt: iso(-6) },
    { id: 't_demo0002', goalId: 'g_demo0001', title: '背 50 个高频词', priority: 'medium', estimate: 30, due: day(0) + 'T22:00', done: false, completedAt: '', createdAt: iso(-3) },
    { id: 't_demo0003', goalId: 'g_demo0001', title: '写两套模拟题', priority: 'high', estimate: 90, due: day(-2) + 'T20:00', done: false, completedAt: '', createdAt: iso(-2) },
    { id: 't_demo0004', goalId: 'g_demo0002', title: '整理项目结构并写 README', priority: 'medium', estimate: 60, due: day(-1) + 'T18:00', done: true, completedAt: iso(-1), createdAt: iso(-5) },
    { id: 't_demo0005', goalId: 'g_demo0002', title: '录制三分钟演示视频', priority: 'high', estimate: 60, due: day(3) + 'T20:00', done: false, completedAt: '', createdAt: iso(-2) },
    { id: 't_demo0006', goalId: 'g_demo0002', title: '按验收清单自测一遍', priority: 'low', estimate: 30, due: day(2) + 'T12:00', done: false, completedAt: '', createdAt: iso(-1) }
  ];
  const checkins = {};
  [-9, -8, -7, -6, -5, -4, -2, -1, 0].forEach((o) => { checkins[day(o)] = true; });
  const profile = {
    exp: 265, level: 3, streak: 4, lastCheckin: day(0), streakBonusCount: 1,
    expLog: [
      { at: iso(-1), source: 'task', refId: 't_demo0001', amount: 20 },
      { at: iso(-1), source: 'task', refId: 't_demo0004', amount: 20 },
      { at: iso(-2), source: 'goal', refId: 'g_demo0000', amount: 50 },
      { at: iso(-3), source: 'checkin', refId: day(-3), amount: 5 },
      { at: iso(-7), source: 'streak', refId: day(-7), amount: 20 }
    ]
  };
  return {
    'lifelite.goals': JSON.stringify(goals),
    'lifelite.tasks': JSON.stringify(tasks),
    'lifelite.checkins': JSON.stringify(checkins),
    'lifelite.profile': JSON.stringify(profile),
    'lifelite.meta': JSON.stringify({ schemaVersion: 1, lastModified: iso(0) })
  };
}

const results = [];
function ok(name, cond, extra) {
  results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || '';
}

(async () => {
  const puppeteer = loadPuppeteer();
  const executablePath = findChrome();
  if (!executablePath) {
    console.error('没有找到 Chrome/Edge，请用 CHROME_PATH 指定浏览器路径。');
    process.exit(2);
  }

  fs.mkdirSync(SHOTS, { recursive: true });
  const { server, port } = await startServer();
  const BASE = 'http://127.0.0.1:' + port + '/';
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--force-prefers-reduced-motion', '--hide-scrollbars']
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(BASE + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate((data) => { Object.keys(data).forEach((k) => localStorage.setItem(k, data[k])); }, demoDataScript());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#goal-list .goal-card');
  await new Promise((r) => setTimeout(r, 300));
  // 默认选中有任务的目标，截图里能同时看到目标与任务列表。
  await page.click('#goal-list .goal-card:nth-child(2)');
  await new Promise((r) => setTimeout(r, 250));

  // 1. 三档及以上宽度：无横向滚动，并顺便截图
  const shots = { 1440: 'desktop-1440.png', 1024: 'tablet-1024.png', 480: 'mobile-480.png' };
  for (const width of [1440, 1024, 768, 480, 375]) {
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 200));
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const overflow = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed' && overflow.length < 4) {
          overflow.push(el.tagName.toLowerCase() + '@' + Math.round(r.right));
        }
      });
      return { vw, scroll: document.documentElement.scrollWidth, overflow };
    });
    ok('宽度 ' + width + ' 无横向滚动', m.scroll <= m.vw, JSON.stringify(m));
    if (shots[width]) {
      await page.screenshot({ path: path.join(SHOTS, shots[width]) });
    }
  }

  // 2. 交互：切换目标、完成任务加经验
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 200));
  await page.click('#goal-list .goal-card:nth-child(2)');
  await new Promise((r) => setTimeout(r, 250));
  const header = await page.$eval('#selected-goal-title', (n) => n.textContent.trim());
  ok('切换目标后任务区标题更新', header === '完成开源文化期末项目', header);
  await page.screenshot({ path: path.join(SHOTS, 'tasks-with-data.png') });

  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('lifelite.profile')).exp);
  await page.click('#task-list .task-row:not(.is-done) .task-check');
  await new Promise((r) => setTimeout(r, 250));
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('lifelite.profile')).exp);
  ok('完成任务后经验增加', after > before, before + ' -> ' + after);
  const toast = await page.evaluate(() => {
    const all = document.querySelectorAll('#toasts .toast-text');
    return all.length ? all[all.length - 1].textContent.trim() : '';
  });
  ok('完成 Toast 文案正确', /^任务完成，\+\d+ 经验。$/.test(toast), toast);
  await page.screenshot({ path: path.join(SHOTS, 'task-done-toast.png') });

  // 3. 快捷键与对话框
  await page.keyboard.press('n');
  await new Promise((r) => setTimeout(r, 250));
  ok('快捷键 N 打开新建目标', await page.$eval('#goal-dialog', (d) => d.open));
  await page.type('#goal-title', '准备下周的组会分享');
  await page.screenshot({ path: path.join(SHOTS, 'dialog-goal.png') });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  ok('Esc 关闭对话框', !(await page.$eval('#goal-dialog', (d) => d.open)));
  ok('取消后没有写入数据', (await page.evaluate(() => JSON.parse(localStorage.getItem('lifelite.goals')).length)) === 3);

  // 4. 删除确认 + 10 秒撤销
  await page.click('#task-list .task-row:not(.is-done) [data-act="delete"]');
  await new Promise((r) => setTimeout(r, 250));
  ok('删除任务弹出确认框', await page.$eval('#confirm-dialog', (d) => d.open));
  await page.click('#confirm-ok');
  await new Promise((r) => setTimeout(r, 250));
  const undo = await page.$('#toasts .toast-action');
  ok('删除后出现撤销按钮', Boolean(undo));
  if (undo) {
    await undo.click();
    await new Promise((r) => setTimeout(r, 250));
  }
  ok('撤销后任务恢复', (await page.evaluate(() => JSON.parse(localStorage.getItem('lifelite.tasks')).length)) === 6);

  // 5. Service Worker 与离线
  await page.evaluate(async () => { if (navigator.serviceWorker) { await navigator.serviceWorker.ready; } });
  await page.reload({ waitUntil: 'networkidle0' });
  ok('Service Worker 已接管页面', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  const offlineCards = await page.evaluate(() => document.querySelectorAll('#goal-list .goal-card').length);
  ok('断网后仍能打开', offlineCards === 3, '卡片数 ' + offlineCards);
  await page.setOfflineMode(false);

  // 6. file:// 双击场景。manifest.json 在 file:// 下会被 CORS 拒绝，这是预期内的控制台噪音。
  const filePage = await browser.newPage();
  const fileErrors = [];
  filePage.on('pageerror', (e) => fileErrors.push(String(e)));
  await filePage.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 700));
  const fileState = await filePage.evaluate(() => ({
    level: document.querySelector('#level-name') ? document.querySelector('#level-name').textContent.trim() : '',
    empty: document.querySelector('#goal-empty-title') ? document.querySelector('#goal-empty-title').textContent.trim() : ''
  }));
  ok('file:// 双击可启动', fileState.level === 'Lv.1 起步者', JSON.stringify(fileState));
  ok('file:// 下无脚本错误', fileErrors.length === 0, fileErrors.join(' | '));

  ok('流程中无浏览器运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log('通过 ' + (results.length - failed.length) + ' 项，失败 ' + failed.length + ' 项');
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
