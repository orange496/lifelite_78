# 贡献指南

感谢你愿意参与 LifeLite。这是一个课程项目的产物，但我们按真实开源项目的协作方式在维护它：
**小步提交、可回溯的历史、每次都过检查再合入。**

在动手之前，请先花五分钟读一遍 [`README.md`](README.md) 和 [`docs/design-decisions.md`](docs/design-decisions.md)——
这个项目最大的特点就是「有意识地不做某些功能」，很多看起来该有的东西是被刻意砍掉的。

---

## 一、环境

- 任意现代浏览器（Chrome / Edge / Firefox / Safari 最近两个大版本）；
- Node.js 18+，只用于跑语法检查与逻辑自测，不产生任何依赖；
- 不需要包管理器，不需要构建。

```bash
git clone https://github.com/<owner>/lifelite.git
cd lifelite
node tests/logic-test.js     # 应该输出「全部通过 ✓」
python -m http.server 8080    # 本地预览（或直接双击 index.html）
```

## 二、分支模型

```text
main        ← 只接受来自 develop 的合并，始终可部署（受保护）
 └ develop  ← 集成分支，所有功能分支合入这里（受保护，需 PR）
    ├ feature/<简短主题>   新功能
    ├ fix/<简短主题>       修 bug
    └ docs/<简短主题>      只改文档
```

规则：

1. **不直接推 `main` 和 `develop`**，通过 Pull Request 合入；
2. 分支名用小写英文与连字符，例如 `feature/goal-progress-tone`；
3. 每个分支只做一件事，控制在合理的大小（经验值：一次 PR 改动 500 行以内）；
4. 合并前先 `git fetch origin && git rebase origin/develop`，保持线性历史；
5. 功能分支合并后删除。

## 三、提交信息

格式：

```text
type(scope): 简短说明
```

- `type`：`feat` 新功能 / `fix` 修 bug / `docs` 文档 / `style` 样式与格式（不改逻辑）/ `refactor` 重构 / `chore` 杂项（依赖、配置）；
- `scope`：受影响的范围，例如 `goals`、`tasks`、`profile`、`stats`、`storage`、`app`、`css`、`docs`、`repo`；
- 说明用中文写清楚「做了什么」，不加句号，不超过 50 字；
- 需要补充动机时，空一行写正文，说明「为什么」而不是「怎么做」。

示例：

```text
feat(tasks): 已完成区超过 20 条时默认折叠
fix(storage): 导入时校验任务引用的目标是否存在
docs(schema): 补充 expLog 去重键的说明
refactor(app): 把刷新编排收敛到 LL.App.refresh
```

## 四、Issue

提 Issue 前先搜索是否已有相同问题。我们提供三种模板：

- **功能建议**（`.github/ISSUE_TEMPLATE/feature_request.md`）：现状、期望、为什么需要、可接受的最小实现；
- **Bug 报告**（`bug_report.md`）：复现步骤、期望结果、实际结果、浏览器与版本、截图；
- **文档问题**（`docs.md`）：位置、问题、建议改法。

**关于新功能**：请先读 [`docs/wukan-sanding.md`](docs/wukan-sanding.md) 的「定策略」一节。
如果一个功能会让体积、依赖或使用步骤增加，它需要非常强的理由，否则大概率会被拒绝——这不是不友好，而是这个项目能保持轻量的原因。

## 五、Pull Request

PR 描述会自动带上 `.github/PULL_REQUEST_TEMPLATE.md`。提交前请自检：

- [ ] 已从最新的 `develop` 变基，无冲突；
- [ ] `node --check` 通过所有改动的 JS 文件；
- [ ] `node tests/logic-test.js` 全部通过；
- [ ] 涉及交互/样式的改动，按 [`tests/manual-checklist.md`](tests/manual-checklist.md) 的相关条目手工验证过；
- [ ] 在 480 / 1024 / 1440 三个宽度下没有横向滚动条；
- [ ] 新增的界面文案与现有风格一致（简洁、口语化、给下一步动作）；
- [ ] 改动了数据结构时，同步更新 `docs/data-schema.md`，并考虑 `lifelite.meta.schemaVersion` 迁移；
- [ ] 没有引入第三方依赖、CDN 外链、构建步骤；
- [ ] 提交信息符合上面的格式。

## 六、代码风格

不引入格式化工具，靠约定：

- **JS**：每个文件一个 IIFE，`'use strict'` 开头；4 空格缩进（与现有文件一致）；单引号；语句结尾带分号；只挂必要的接口到 `LL` 命名空间；
- **注释**：解释「为什么」，不复述代码；每个模块顶部有一段职责说明；
- **数据读写**：一律走 `LL.Storage` 的公开方法，不直接碰 `localStorage`；
- **渲染**：从数据层重算，不在模块里缓存派生状态；
- **防注入**：插值到 `innerHTML` 的用户文本一律经过 `LL.Util.esc()`；
- **CSS**：颜色、圆角、阴影优先用 `:root` 里的设计令牌，不写魔法值；新增组件放在对应分区，按 1024 / 640 两个断点补充响应式；
- **HTML**：新增可交互元素要带可访问名称（`aria-label` 或可见文本），保证键盘可达。

## 七、冲突演练（必读）

课程要求每个人都动手操作一次合并冲突。下面是最小演练流程，请在**本地**完成，不要推演练分支：

```bash
# 1. 从 develop 切一个演练分支
git switch develop && git pull
git switch -c chore/conflict-drill

# 2. 修改 README.md 的「已知问题」一节，随便加一行，提交
git add README.md && git commit -m "docs(readme): 冲突演练 A"

# 3. 回到 develop，在同一个位置做另一处修改并提交（模拟别人先合入）
git switch develop
# 修改同样的行
git add README.md && git commit -m "docs(readme): 冲突演练 B"

# 4. 把演练分支变基到 develop，触发冲突
git switch chore/conflict-drill
git rebase develop
```

冲突时：

1. `git status` 看哪些文件冲突；
2. 打开冲突文件，找到 `<<<<<<<` / `=======` / `>>>>>>>` 标记；
3. **两边的意图都理解后再决定保留什么**——不要直接选一边了事，通常正确做法是把两边的内容合并成一段通顺的文字；
4. 删掉所有冲突标记，保存；
5. `git add <文件>` → `git rebase --continue`；
6. 跑一遍 `node tests/logic-test.js` 确认没弄坏别的东西。

如果搞砸了想回到变基之前：`git rebase --abort`；已经提交了也可以 `git reflog` 找到原来的提交。

演练完成后删除分支：`git branch -D chore/conflict-drill`，并确认真实的代码没有被演练污染。

## 八、发布与部署

LifeLite 没有版本发布流程：`main` 分支的根目录就是部署产物，GitHub Pages 直接从这里读取。
合入 `main` 前请确认 `develop` 上的验收清单已全部通过。

如果修改了 `sw.js` 的缓存清单或任一被缓存的静态资源，**必须同时把 `CACHE_VERSION` 加一**，否则老用户会一直拿到旧缓存。
