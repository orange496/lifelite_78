# LifeLite · 学习目标看板

把一个学期的长期目标拆成**今天就能做完的小任务**，每天打卡，完成就攒经验、升级、看连续天数。
没有账号、没有服务器、没有构建步骤——**双击 `index.html` 就能用**。

> 项目定位与取舍的分析见 [`docs/wukan-sanding.md`](docs/wukan-sanding.md)，界面草图见 [`docs/wireframe.svg`](docs/wireframe.svg)。

[界面草图](docs/wireframe.svg) · [数据结构](docs/data-schema.md) · [设计决策](docs/design-decisions.md) · [验收清单](tests/manual-checklist.md)

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [部署到 GitHub Pages](#部署到-github-pages)
- [项目结构](#项目结构)
- [数据与体积](#数据与体积)
- [本地开发与测试](#本地开发与测试)
- [快捷键](#快捷键)
- [设计决策摘要](#设计决策摘要)
- [已知问题](#已知问题)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 功能特性

| 编号 | 功能 | 说明 |
| --- | --- | --- |
| F1 | 目标管理 | 新建 / 编辑 / 删除（含二次确认与级联删除）/ 归档与恢复；名称、描述、截止日期、颜色 |
| F2 | 任务管理 | 任务必须挂在目标下；优先级、预计时长、截止时间；完成后沉底，支持 10 秒撤销 |
| F3 | 目标进度 | 按已完成任务数实时计算百分比，三档颜色；没有任务时显示「尚未拆解」而不是 0% |
| F4 | 打卡与连续天数 | 每天一次，断签不清空历史；最近八周热力图 |
| F5 | 经验与等级 | 完成任务、打卡、完成目标都能攒经验；等级只升不降，升级即时提示 |
| F6 | 统计 | 本周完成、本周新增、整体完成率、连续天数，加最近七天趋势条形 |
| F7 | 导入 / 导出 | 导出为带版本号的 JSON；导入前校验并提示将覆盖的条数，覆盖前自动备份 |
| F8 | 可用性与空状态 | 空状态引导下一步动作、Toast 反馈、快捷键、三档响应式布局 |

**刻意不做**：账号体系、云同步、消息推送、社交排行、深色模式、多语言、子任务、标签、甘特图。
理由见 [`docs/wukan-sanding.md`](docs/wukan-sanding.md) 与 [`docs/design-decisions.md`](docs/design-decisions.md)。

## 快速开始

### 方式一：直接双击（推荐交给同学用）

下载或克隆仓库，双击 `index.html` 即可。数据保存在浏览器 `localStorage` 中，与 `file://` 路径绑定。

> 注意：`file://` 下浏览器不允许注册 Service Worker，因此「安装到桌面 / 完全离线」需要在方式二或 GitHub Pages 下体验。

### 方式二：本地起一个静态服务器

```bash
# 任选其一，在仓库根目录执行
python -m http.server 8080
# 或
npx serve .
```

然后打开 <http://localhost:8080>。

## 部署到 GitHub Pages

1. 在 GitHub 上新建仓库（例如 `lifelite`），把本仓库推上去：

   ```bash
   git remote add origin https://github.com/<你的用户名>/lifelite.git
   git branch -M main
   git push -u origin main
   ```

2. 打开仓库 **Settings → Pages**；
3. **Source** 选择 `Deploy from a branch`，**Branch** 选 `main`、目录选 `/ (root)`，保存；
4. 等一两分钟，访问 `https://<你的用户名>.github.io/lifelite/`。

不需要任何构建步骤或 Actions 配置——这就是「零构建」的好处。
部署后可通过浏览器菜单「安装应用」把 LifeLite 装到桌面，Service Worker 会缓存整个应用外壳，断网也能打开。

## 项目结构

```text
lifelite/
├── index.html                 # 唯一页面：顶栏 / 统计 / 双栏 / 三个对话框
├── css/
│   └── style.css              # 全部样式（设计令牌 + 组件 + 三档响应式）
├── js/
│   ├── storage.js             # 数据层：localStorage 读写、迁移、导入导出校验
│   ├── profile.js             # 经验 / 等级 / 打卡 / 连续天数 / 热力图
│   ├── goals.js               # 目标 CRUD、列表渲染、进度计算
│   ├── tasks.js               # 任务 CRUD、排序、折叠、渲染
│   ├── stats.js               # 本周统计与七天趋势
│   └── app.js                 # 启动、事件绑定、Toast、确认框、快捷键、SW 注册
├── manifest.json              # PWA 清单
├── sw.js                      # Service Worker：应用外壳离线缓存
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-512-maskable.png
├── docs/
│   ├── wukan-sanding.md       # 五看三定：产品定位与范围取舍
│   ├── data-schema.md         # localStorage 键、字段、导入导出格式
│   ├── design-decisions.md    # 设计决策记录（为什么这么做）
│   └── wireframe.svg          # 桌面端界面草图
├── tests/
│   ├── logic-test.js          # 零依赖 Node 自测：计算与规则类逻辑
│   ├── static-check.js        # 连线检查：id / 资源引用 / 脚本顺序 / 体积
│   └── manual-checklist.md    # 手工验收清单（15 条主验收 + 补充自测）
├── tools/
│   └── make-icons.py          # 开发期一次性脚本：重新生成图标
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── feature_request.md
│   │   ├── bug_report.md
│   │   └── docs.md
│   └── PULL_REQUEST_TEMPLATE.md
├── .editorconfig
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

脚本加载顺序固定为 `storage → profile → goals → tasks → stats → app`，因为用的是经典脚本而不是 ES Module（原因见[设计决策 #1](docs/design-decisions.md)）。

## 数据与体积

- 数据全部在浏览器 `localStorage`，键名统一 `lifelite.` 前缀，字段说明见 [`docs/data-schema.md`](docs/data-schema.md)。
- 运行时不发任何第三方请求，没有 CDN、没有字体外链、没有统计脚本。
- 首屏资源（HTML + CSS + JS + manifest + 192 图标）约 **145 KB**，满足「页面体积 < 200 KB」的约束。

## 本地开发与测试

不需要 `npm install`，没有构建步骤。

**语法检查与逻辑自测**（需要 Node.js 18+）：

```bash
node --check js/app.js          # 逐个文件语法检查
node tests/logic-test.js        # 计算与规则类逻辑自测
node tests/static-check.js      # 静态一致性检查：id、资源引用、脚本顺序、体积
```

`tests/logic-test.js` 用最小的 `window` / `document` / `localStorage` 替身直接加载 `js/` 下的脚本，
覆盖经验等级公式、任务排序、幂等、级联删除、打卡连签、导入校验、统计口径等规则，
不需要浏览器也不需要任何依赖。

`tests/static-check.js` 检查 JS 里引用的每个元素 id 是否真的出现在 `index.html`、页面引用的资源是否存在、
脚本加载顺序是否与设计一致、Service Worker 的预缓存清单是否覆盖页面资源、首屏体积是否超标——
这类错误在浏览器里往往表现为「点了没反应」，用脚本查比手点快。

**交互与视觉**按 [`tests/manual-checklist.md`](tests/manual-checklist.md) 手工验收，至少覆盖 480 / 1024 / 1440 三个宽度。

**重新生成图标**（可选，需要 Pillow）：

```bash
python tools/make-icons.py
```

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `N` | 新建目标 |
| `T` | 新建任务（当前选中的目标） |
| `Enter` | 在表单中保存 |
| `Esc` | 关闭对话框 / 取消编辑 |

光标在输入框内或有对话框打开时，快捷键自动让路。

## 设计决策摘要

完整的取舍记录在 [`docs/design-decisions.md`](docs/design-decisions.md)，这里只列最影响使用体验的几条：

1. **经验只加不减**：撤销完成、删除任务都不回收经验。中断一天不会有「前功尽弃」的惩罚，降低放弃概率。
2. **任务必须归属目标**：没有目标就不能建任务，逼用户先想清楚「为什么做」。
3. **幂等在数据层实现**：完成状态以 `completedAt` 是否为判据，经验按 `(source, refId)` 去重，连点不会重复加经验。
4. **渲染一律从数据重算**：不缓存进度和统计，杜绝「改完任务进度不动」的经典 bug。
5. **零依赖零构建**：经典 `<script>` + 全局 `LL` 命名空间，保证双击 `index.html` 可用；PWA 离线能力只在 http(s) 环境生效。

## 已知问题

诚实记录，不假装不存在：

- **数据只在这台浏览器里**：换设备或清理浏览器数据需要手动「导出 / 导入」JSON。这是「无账号」的直接代价。
- **日期按本机时间计算**：手动修改系统时间、跨时区旅行时「今天」可能跳变，打卡与连续天数不做特殊处理。
- **存在刷经验漏洞**：建任务 → 完成 → 删除，经验不会回收。这是「只加不减」的刻意取舍，目标产品不是反作弊。
- **`file://` 下无 Service Worker**：双击打开时无法「安装到桌面」，离线与安装能力需要静态服务器或 GitHub Pages。
- **深色模式未实现**：方案中列为可选项，本版本不做。
- **超大数据量**：`localStorage` 单域约 5 MB，几千条目标/任务以内没问题，超出时写入会失败并提示。

## 贡献指南

完整的协作规范（分支模型、提交信息、Issue/PR 模板、代码风格、冲突演练）见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。这里给个最短版本：

- 分支：`main`（保护）← `develop`（保护）← `feature/*`；
- 提交信息：`type(scope): 简短说明`，`type` 取 `feat` / `fix` / `docs` / `style` / `refactor` / `chore`；
- 合入前必须勾完 PR 检查清单，并通过 `node --check` 与 `node tests/logic-test.js`；
- 改动数据结构时，同步更新 [`docs/data-schema.md`](docs/data-schema.md) 并考虑迁移。

## 许可证

[MIT](LICENSE) © 2026 LifeLite Team
