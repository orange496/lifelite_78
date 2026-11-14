# 贡献指南

感谢你愿意参与 LifeLite。这是一个课程项目的产物，但按真实开源项目的协作方式维护：
**小步提交、可回溯的历史、每次都跑通再合入。**

动手前建议先读 [README](README.md) 的「设计取舍」与「已知问题」——这个项目最大的特点是
「有意识地不做某些功能」，很多看起来该有的东西是被刻意砍掉的。参与前也请阅读
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

---

## 一、环境

- 任意现代浏览器（Chrome / Edge / Firefox / Safari 最近两个大版本）；
- 本地静态服务器即可预览，不需要包管理器、不需要构建、不需要安装依赖。

```bash
git clone https://github.com/<owner>/lifelite.git
cd lifelite
python -m http.server 8080    # 或直接双击 index.html
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

1. 不直接推 `main` 和 `develop`，通过 Pull Request 合入；
2. 分支名用小写英文与连字符，例如 `feature/goal-progress`；
3. 每个分支只做一件事，一次 PR 改动控制在 500 行以内；
4. 合并前先 `git fetch origin && git rebase origin/develop`，保持线性历史；
5. 功能分支合并后删除。

## 三、提交信息

格式：`type(scope): 简短说明`

- `type`：`feat` 新功能 / `fix` 修 bug / `docs` 文档 / `style` 样式与格式（不改逻辑） / `refactor` 重构 / `chore` 杂项；
- `scope`：`storage`、`goals`、`tasks`、`profile`、`stats`、`book`、`ui`、`docs`、`repo` 等；
- 说明用中文写清楚「做了什么」，不超过 50 字，不加句号；
- 需要补充动机时空一行写正文，说明「为什么」而不是「怎么做」。

示例：

```text
feat(book): 页码处增加目录跳转
fix(ui): 翻页改为绕左侧书脊从右往左
docs(readme): 补充数据键位与经验规则
```

## 四、Issue

提 Issue 前先搜索是否已有相同问题。仓库提供三种模板：

- **功能建议**：现状、期望、为什么需要、可接受的最小实现；
- **Bug 报告**：复现步骤、期望结果、实际结果、浏览器与版本、截图；
- **文档问题**：位置、问题、建议改法。

**关于新功能**：请先读 README 的「设计取舍」。如果一个功能会让体积、依赖或使用步骤增加，
它需要非常强的理由，否则大概率会被拒绝——这不是不友好，而是这个项目能保持轻量的原因。

## 五、Pull Request

PR 描述会自动带上 `.github/PULL_REQUEST_TEMPLATE.md`。提交前请自检：

- [ ] 已从最新的 `develop` 变基，无冲突；
- [ ] 本地手动过一遍主流程：打开 → 新建主任务 → 加子任务 → 展开/收起 → 完成 → 打卡 → 翻页；
- [ ] 在 375 / 480 / 1024 / 1440 四个宽度下没有横向滚动条；
- [ ] 新增文案与现有风格一致（简洁、口语化、给下一步动作）；
- [ ] 用户输入的文本在插入 DOM 前经过 `LL.Util.esc()`；
- [ ] 未引入第三方依赖、CDN 外链、构建步骤；
- [ ] 提交信息符合上面的格式。

## 六、代码风格

- **JS**：每个文件一个 IIFE，`'use strict'` 开头；2 空格缩进；单引号；语句结尾带分号；只向 `LL` 命名空间挂必要接口；
- **注释**：解释「为什么」，不复述代码；每个模块顶部写清职责；
- **数据读写**：一律走 `LL.Storage` 的公开方法，不直接操作 `localStorage`；
- **渲染**：从数据层重算，不在模块里缓存派生状态；
- **CSS**：颜色、圆角、阴影优先用 `:root` 的设计令牌；新增组件按 900px 断点补响应式；
- **HTML**：新增可交互元素要带可访问名称（`aria-label` 或可见文本），保证键盘可达。

## 七、冲突演练

课程要求每个人动手操作一次合并冲突。下面是最小流程，请在本地完成，不要推演练分支：

```bash
# 1. 从 develop 切出演练分支
git switch develop && git pull
git switch -c chore/conflict-drill

# 2. 修改 README.md 的「已知问题」一节，提交
git add README.md && git commit -m "docs(readme): 冲突演练 A"

# 3. 回到 develop，在同一位置做另一处修改并提交
git switch develop
# 修改同样的行
git add README.md && git commit -m "docs(readme): 冲突演练 B"

# 4. 把演练分支变基到 develop，触发冲突
git switch chore/conflict-drill
git rebase develop
```

冲突时：`git status` 看冲突文件 → 找到 `<<<<<<<` / `=======` / `>>>>>>>` → 理解两边意图后合并成通顺的一段 →
删除标记 → `git add` → `git rebase --continue`。搞砸了可以 `git rebase --abort`，已提交的也能用 `git reflog` 找回。
演练完成后删除分支：`git branch -D chore/conflict-drill`。

## 八、发布与部署

`main` 分支的根目录就是部署产物，GitHub Pages 直接读取，没有额外构建步骤。

如果修改了 `sw.js` 的缓存清单或任一被缓存的静态资源，**必须同时把 `CACHE_VERSION` 加一**，
并同步 `index.html` 中资源的版本参数（`?v=N`），否则老用户会继续拿到旧缓存。
