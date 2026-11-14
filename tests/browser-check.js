/*
 * 真实浏览器验收脚本（可选，需要 Node 18+ 与本机 Chrome/Edge）
 *
 * 用途：在真实 Chrome 里检查记事本界面：封面 / 扉页 / 任务页、展开子任务、
 * 完成加经验、翻页动画、行内菜单、归档箱、断网可用与 file:// 双击启动，
 * 并顺便生成 docs/screenshots/ 下的截图。它不参与应用运行，应用本身零依赖。
 *
 * 准备：
 *   npm i puppeteer-core --no-save
 *   node tests/browser-check.js          # 可用 CHROME_PATH 指定浏览器
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
    { id: 'g_1', title: '通过大学英语六级', desc: '每天 30 分钟听力。', due: day(46), color: 'green', status: 'active', createdAt: iso(-6) },
    { id: 'g_2', title: '完成开源文化期末项目', desc: '交付到 GitHub。', due: day(4), color: 'violet', status: 'active', createdAt: iso(-5) },
    { id: 'g_3', title: '每周跑三次步', desc: '先稳住频率。', due: '', color: 'amber', status: 'active', createdAt: iso(-4) },
    { id: 'g_4', title: '整理上学期的笔记', desc: '', due: day(-20), color: 'slate', status: 'archived', createdAt: iso(-40) }
  ];
  const tasks = [
    { id: 't_1', goalId: 'g_1', title: '精听一套真题听力', priority: 'high', estimate: 60, due: day(-1) + 'T21:00', done: true, completedAt: iso(-1), createdAt: iso(-6) },
    { id: 't_2', goalId: 'g_1', title: '背 50 个高频词', priority: 'medium', estimate: 30, due: day(0) + 'T22:00', done: false, completedAt: '', createdAt: iso(-3) },
    { id: 't_3', goalId: 'g_1', title: '写两套模拟题', priority: 'high', estimate: 90, due: day(-2) + 'T20:00', done: false, completedAt: '', createdAt: iso(-2) },
    { id: 't_4', goalId: 'g_2', title: '整理项目结构并写 README', priority: 'medium', estimate: 60, due: day(-1) + 'T18:00', done: true, completedAt: iso(-1), createdAt: iso(-5) },
    { id: 't_5', goalId: 'g_2', title: '录制三分钟演示视频', priority: 'high', estimate: 60, due: day(3) + 'T20:00', done: false, completedAt: '', createdAt: iso(-2) },
    { id: 't_6', goalId: 'g_2', title: '按验收清单自测一遍', priority: 'low', estimate: 30, due: day(2) + 'T12:00', done: false, completedAt: '', createdAt: iso(-1) },
    { id: 't_7', goalId: 'g_3', title: '慢跑 30 分钟', priority: 'medium', estimate: 30, due: '', done: false, completedAt: '', createdAt: iso(-3) },
    { id: 't_8', goalId: 'g_3', title: '拉伸 10 分钟', priority: 'low', estimate: 15, due: '', done: false, completedAt: '', createdAt: iso(-2) }
  ];
  const checkins = {};
  [-9, -8, -7, -6, -5, -4, -2, -1, 0].forEach((o) => { checkins[day(o)] = true; });
  const profile = {
    exp: 265, level: 3, streak: 3, lastCheckin: day(0), streakBonusCount: 1,
    expLog: [{ at: iso(-1), source: 'task', refId: 't_1', amount: 20 }]
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
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  await page.goto(BASE + 'index.html', { waitUntil: 'networkidle0' });
  await page.evaluate((data) => { Object.keys(data).forEach((k) => localStorage.setItem(k, data[k])); }, demoDataScript());
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));

  // 1. 封面
  ok('封面已渲染', Boolean(await page.$('.sheet--cover')));
  await page.screenshot({ path: path.join(SHOTS, 'notebook-cover.png') });

  // 2. 目录：点页码展开、跳转扉页
  await page.click('#page-indicator');
  await new Promise((r) => setTimeout(r, 250));
  const toc = await page.evaluate(() => ({
    open: !document.getElementById('toc-menu').hidden,
    items: document.querySelectorAll('.toc-item').length,
    active: document.querySelector('.toc-item.is-active')
      ? document.querySelector('.toc-item.is-active').textContent.trim()
      : '',
    expanded: document.getElementById('page-indicator').getAttribute('aria-expanded')
  }));
  ok('点击页码展开目录', toc.open && toc.expanded === 'true', JSON.stringify(toc));
  ok('目录列出封面/扉页/任务页', toc.items === 3, String(toc.items));
  ok('目录高亮当前页', toc.active.indexOf('封面') >= 0, toc.active);
  await page.screenshot({ path: path.join(SHOTS, 'notebook-toc.png') });

  await page.click('.toc-item[data-page="1"]');
  await new Promise((r) => setTimeout(r, 900));
  ok('点目录跳转到扉页', await page.evaluate(() => Boolean(document.querySelector('.front-level'))));
  ok('跳转后目录收起', await page.evaluate(() => document.getElementById('toc-menu').hidden));

  const front = await page.evaluate(() => ({
    level: document.querySelector('.front-level') ? document.querySelector('.front-level').textContent.trim() : '',
    reward: Boolean(document.querySelector('.reward-placeholder')),
    indicator: document.getElementById('page-indicator').textContent.trim()
  }));
  ok('扉页显示等级与经验', front.level.indexOf('Lv.3') >= 0, JSON.stringify(front));
  ok('扉页有升级奖励占位', front.reward);
  await page.screenshot({ path: path.join(SHOTS, 'notebook-front.png') });

  // 3. 任务页与展开
  await page.click('#btn-next');
  await new Promise((r) => setTimeout(r, 900));
  const collapsed = await page.evaluate(() => ({
    goals: document.querySelectorAll('.line--goal').length,
    subs: document.querySelectorAll('.line--sub').length,
    lines: document.querySelectorAll('.sheet-body > .line').length
  }));
  ok('任务页有 3 个主任务', collapsed.goals === 3, JSON.stringify(collapsed));
  ok('每页固定 14 行', collapsed.lines === 14, String(collapsed.lines));
  ok('默认收起子任务', collapsed.subs === 0);
  await page.screenshot({ path: path.join(SHOTS, 'notebook-tasks.png') });

  // 3.5 页脚入口：加完一条还能继续加
  ok('任务页页脚有新增入口', Boolean(await page.$('.foot-add')));
  await page.click('.foot-add');
  await new Promise((r) => setTimeout(r, 300));
  ok('页脚入口能再次打开新建对话框', await page.evaluate(() => document.getElementById('goal-dialog').open));
  await page.type('#goal-title', '再写一条主任务');
  await page.evaluate(() => {
    document.getElementById('goal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 500));
  ok('添加后纸上出现新主任务', await page.evaluate(() => document.body.innerText.indexOf('再写一条主任务') >= 0));
  ok('添加后主任务数量增加', (await page.evaluate(() => document.querySelectorAll('.line--goal').length)) >= 4);

  await page.click('.line--goal[data-goal-id="g_1"]');
  await new Promise((r) => setTimeout(r, 350));
  const expanded = await page.evaluate(() => ({
    subs: document.querySelectorAll('.line--sub').length,
    pressed: document.querySelector('.line--goal[data-goal-id="g_1"]').getAttribute('aria-expanded')
  }));
  ok('点击主任务展开子任务', expanded.subs === 3 && expanded.pressed === 'true', JSON.stringify(expanded));
  const indent = await page.evaluate(() => {
    const goalTitle = document.querySelector('.line--goal[data-goal-id="g_1"] .line-title').getBoundingClientRect().left;
    const subTitle = document.querySelector('.line--sub .line-title').getBoundingClientRect().left;
    return Math.round(subTitle - goalTitle);
  });
  ok('子任务首行缩进约两字符', indent >= 24 && indent <= 40, indent + 'px');
  await page.screenshot({ path: path.join(SHOTS, 'notebook-expanded.png') });

  // 4. 完成子任务加经验
  const expBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lifelite.profile')).exp);
  await page.click('.line--sub .line-check');
  await new Promise((r) => setTimeout(r, 400));
  const expAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('lifelite.profile')).exp);
  ok('完成子任务后经验增加', expAfter > expBefore, expBefore + ' -> ' + expAfter);

  // 5. 行内菜单
  await page.click('.line--goal .line-more');
  await new Promise((r) => setTimeout(r, 200));
  ok('行尾菜单打开', await page.evaluate(() => !document.getElementById('line-menu').hidden));
  await page.screenshot({ path: path.join(SHOTS, 'notebook-menu.png') });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.menu-item')).find((b) => b.textContent.indexOf('子任务') >= 0);
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  ok('菜单可打开子任务对话框', await page.evaluate(() => document.getElementById('task-dialog').open));
  await page.screenshot({ path: path.join(SHOTS, 'notebook-dialog.png') });
  await page.keyboard.press('Escape');

  // 6. 翻页动画
  await page.click('#btn-prev');
  await new Promise((r) => setTimeout(r, 900));
  await page.click('#btn-next');
  await new Promise((r) => setTimeout(r, 140));
  const flip = await page.evaluate(() => {
    const el = document.getElementById('flip');
    return { cls: el.className, hasContent: el.innerHTML.length > 0 };
  });
  ok('翻页动画在播', flip.cls.indexOf('is-') >= 0 && flip.hasContent, JSON.stringify(flip));
  await page.screenshot({ path: path.join(SHOTS, 'notebook-flip.png') });
  await new Promise((r) => setTimeout(r, 800));

  // 7. 归档箱
  await page.click('#btn-prev');
  await new Promise((r) => setTimeout(r, 900));
  await page.click('.archive-link');
  await new Promise((r) => setTimeout(r, 400));
  const archive = await page.evaluate(() => ({
    banner: Boolean(document.querySelector('.archive-banner')),
    goals: document.querySelectorAll('.line--goal').length
  }));
  ok('归档箱显示归档主任务', archive.banner && archive.goals === 1, JSON.stringify(archive));
  await page.screenshot({ path: path.join(SHOTS, 'notebook-archive.png') });
  await page.evaluate(() => {
    const back = Array.from(document.querySelectorAll('[data-act="archive-mode"]'))[0];
    if (back) back.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  // 8. 多宽度无横向溢出
  for (const width of [1440, 1024, 768, 480, 375]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 200));
    const m = await page.evaluate(() => ({ vw: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    ok('宽度 ' + width + ' 无横向滚动', m.scroll <= m.vw, JSON.stringify(m));
  }

  // 9. Service Worker 与离线
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(async () => { if (navigator.serviceWorker) { await navigator.serviceWorker.ready; } });
  await page.reload({ waitUntil: 'networkidle0' });
  ok('Service Worker 已接管页面', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  const offline = await page.evaluate(() => ({
    goals: document.querySelectorAll('.line--goal').length,
    front: Boolean(document.querySelector('.sheet--cover'))
  }));
  ok('断网后仍能打开', offline.front || offline.goals > 0, JSON.stringify(offline));
  await page.setOfflineMode(false);

  // 10. file:// 双击
  const filePage = await browser.newPage();
  const fileErrors = [];
  filePage.on('pageerror', (e) => fileErrors.push(String(e)));
  await filePage.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 700));
  ok('file:// 双击可启动', await filePage.evaluate(() => Boolean(document.querySelector('.sheet--cover'))));
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
