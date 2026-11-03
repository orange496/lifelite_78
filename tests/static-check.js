/*!
 * tests/static-check.js — 静态一致性检查
 * ---------------------------------------------------------------------------
 * 这不是逻辑测试（见 logic-test.js），而是「连线检查」：确认 JS 里引用的
 * 元素 id 真的存在于 index.html，确认页面引用的资源真的存在，确认加载顺序
 * 与设计一致。这类错误在浏览器里表现为「点了没反应」，用脚本查更快。
 *
 * 运行：node tests/static-check.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const problems = [];
const notes = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function fail(message) {
  problems.push(message);
}

/* ------------------------- 1. index.html 的 id 清单 ------------------------- */
const html = read('index.html');
const htmlIds = new Set();
html.replace(/\bid="([^"]+)"/g, (match, id) => {
  htmlIds.add(id);
  return match;
});
notes.push('index.html 共有 ' + htmlIds.size + ' 个 id');

/* ------------------------- 2. JS 里 getElementById 的引用 ------------------------- */
const JS_FILES = ['storage.js', 'profile.js', 'goals.js', 'tasks.js', 'stats.js', 'app.js'];
const referenced = new Map(); // id -> [file]

JS_FILES.forEach((file) => {
  const source = read(path.join('js', file));
  const regex = /getElementById\(\s*'([^']+)'\s*\)/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const id = match[1];
    if (!referenced.has(id)) referenced.set(id, []);
    referenced.get(id).push(file);
  }
  // 也检查 document.querySelector('#xxx')
  const qs = /querySelector(?:All)?\(\s*'#([A-Za-z0-9_-]+)'/g;
  while ((match = qs.exec(source)) !== null) {
    const id = match[1];
    if (!referenced.has(id)) referenced.set(id, []);
    referenced.get(id).push(file + ' (querySelector)');
  }
});

referenced.forEach((files, id) => {
  if (!htmlIds.has(id)) {
    fail('JS 引用了不存在的 id「' + id + '」（出现在 ' + files.join(', ') + '）');
  }
});
notes.push('JS 共引用 ' + referenced.size + ' 个 id');

/* ------------------------- 3. 事件委托里用到的 data-act ------------------------- */
// 不做强校验：data-act 是字符串分派，缺一个分支只在运行时暴露，这里只统计
const acts = new Set();
JS_FILES.forEach((file) => {
  const source = read(path.join('js', file));
  const regex = /act\s*===\s*'([a-z]+)'|case\s*'([a-z]+)':/g;
  let match;
  while ((match = regex.exec(source)) !== null) acts.add(match[1] || match[2]);
});
notes.push('data-act 分支共 ' + acts.size + ' 个：' + Array.from(acts).sort().join(', '));

/* ------------------------- 4. 页面引用的资源必须存在 ------------------------- */
const assetRefs = [];
html.replace(/(?:src|href)="([^"#]+)"/g, (match, url) => {
  if (/^(https?:|mailto:|data:|#)/.test(url)) return match;
  assetRefs.push(url);
  return match;
});
assetRefs.forEach((url) => {
  if (!exists(url)) fail('index.html 引用的资源不存在：' + url);
});
notes.push('index.html 引用 ' + assetRefs.length + ' 个本地资源');

/* ------------------------- 5. 脚本顺序 ------------------------- */
const scriptOrder = [];
html.replace(/<script\s+src="([^"]+)"/g, (match, src) => {
  scriptOrder.push(src);
  return match;
});
const expectedOrder = [
  'js/storage.js',
  'js/profile.js',
  'js/goals.js',
  'js/tasks.js',
  'js/stats.js',
  'js/app.js'
];
if (scriptOrder.join(',') !== expectedOrder.join(',')) {
  fail('脚本加载顺序不对，期望 ' + expectedOrder.join(' → ') + '，实际 ' + scriptOrder.join(' → '));
}

const moduleScripts = html.match(/<script[^>]*type="module"/g);
if (moduleScripts) fail('出现了 type="module"：file:// 下会被 CORS 拦截，破坏双击可用的能力');

/* ------------------------- 6. manifest 与 SW 的一致性 ------------------------- */
const manifest = JSON.parse(read('manifest.json'));
if (!manifest.icons || !manifest.icons.length) fail('manifest.json 没有声明 icons');
(manifest.icons || []).forEach((icon) => {
  if (!exists(icon.src)) fail('manifest.json 里的图标不存在：' + icon.src);
});
['start_url', 'scope'].forEach((key) => {
  if (!manifest[key]) fail('manifest.json 缺少 ' + key);
});

const sw = read('sw.js');
const cacheVersion = sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/);
if (!cacheVersion) fail('sw.js 里找不到 CACHE_VERSION');
const shellBlock = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!shellBlock) {
  fail('sw.js 里找不到 APP_SHELL');
} else {
  const listed = [];
  shellBlock[1].replace(/'([^']+)'/g, (match, item) => {
    listed.push(item);
    return match;
  });
  listed.forEach((item) => {
    if (item === './') return;
    const rel = item.replace(/^\.\//, '');
    if (!exists(rel)) fail('APP_SHELL 里列出的文件不存在：' + item);
  });
  // 页面引用的静态资源都应进缓存清单，避免「断网打开少文件」
  assetRefs.forEach((url) => {
    if (url === 'sw.js') return;
    if (listed.indexOf('./' + url) < 0) fail('APP_SHELL 未缓存页面引用的资源：' + url);
  });
  notes.push('APP_SHELL 预缓存 ' + listed.length + ' 项，缓存版本 ' + (cacheVersion ? cacheVersion[1] : '?'));
}

/* ------------------------- 7. CSS 与 JS 的类名粗检 ------------------------- */
// 只检查「JS 里写死的关键类名」在 CSS 中有定义，防止渲染出没有样式的裸元素
const css = read('css/style.css');
const requiredClasses = [
  'toast',
  'toast-text',
  'toast-action',
  'toast-detail',
  'goal-card',
  'goal-desc',
  'goal-meta',
  'goal-name',
  'goal-card-actions',
  'progress',
  'progress-fill',
  'is-empty',
  'task-row',
  'task-check',
  'task-main',
  'task-title',
  'task-meta',
  'chip',
  'task-actions',
  'empty',
  'empty-title',
  'task-group-label',
  'task-group-toggle',
  'trend-day',
  'trend-bar',
  'trend-label',
  'heat-cell'
];
requiredClasses.forEach((name) => {
  if (css.indexOf('.' + name) < 0) fail('style.css 里找不到类名 .' + name + '（JS 渲染时在用）');
});

// 内联 HTML 里用到的 id 必须在 CSS/JS 之外没有拼写偏差（抽查关键 id 命名规范）
['level-name', 'level-exp', 'exp-fill', 'btn-checkin', 'goal-list', 'task-list'].forEach((id) => {
  if (!htmlIds.has(id)) fail('index.html 缺少关键元素 #' + id);
});

/* ------------------------- 8. 体积与外部请求 ------------------------- */
const sizeFiles = [
  'index.html',
  'css/style.css',
  'js/storage.js',
  'js/profile.js',
  'js/goals.js',
  'js/tasks.js',
  'js/stats.js',
  'js/app.js',
  'manifest.json',
  'icons/icon-192.png'
];
let total = 0;
sizeFiles.forEach((file) => {
  total += fs.statSync(path.join(ROOT, file)).size;
});
notes.push('首屏资源合计 ' + (total / 1024).toFixed(1) + ' KB');
if (total > 200 * 1024) fail('首屏资源超过 200 KB：' + (total / 1024).toFixed(1) + ' KB');

const external = html.match(/(?:src|href)="https?:\/\/[^"]+"/g);
if (external) fail('index.html 存在外部资源引用（破坏离线可用）：' + external.join(', '));

/* ------------------------- 9. 报告 ------------------------- */
console.log('静态检查结果：');
notes.forEach((note) => console.log('  · ' + note));
if (problems.length) {
  console.log('');
  console.log('发现 ' + problems.length + ' 个问题：');
  problems.forEach((item) => console.log('  ✗ ' + item));
  process.exitCode = 1;
} else {
  console.log('');
  console.log('全部通过 ✓');
}
