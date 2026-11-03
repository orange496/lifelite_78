# Pull Request

## 这个 PR 做了什么

<!-- 一两句话说明改动，关联的 Issue 用「Closes #123」。 -->

Closes #

## 改动类型

- [ ] `feat` 新功能
- [ ] `fix` 修复 bug
- [ ] `docs` 文档
- [ ] `style` 样式/格式（不改逻辑）
- [ ] `refactor` 重构
- [ ] `chore` 杂项

## 检查清单

提交前请逐项确认（详见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)）：

- [ ] 已基于最新的 `develop` 变基，无冲突
- [ ] 只做了一件事，改动规模合理
- [ ] `node --check` 通过所有改动的 JS 文件
- [ ] `node tests/logic-test.js` 全部通过
- [ ] 涉及交互/样式的改动，已按 `tests/manual-checklist.md` 相关条目手工验证
- [ ] 480 / 1024 / 1440 三档宽度无横向滚动条
- [ ] 新增文案与现有风格一致，用户文本经过 `LL.Util.esc()`
- [ ] 没有引入第三方依赖、CDN 外链或构建步骤
- [ ] 改了数据结构时，同步更新 `docs/data-schema.md` 并考虑迁移
- [ ] 改了 `sw.js` 缓存清单或静态资源时，已把 `CACHE_VERSION` 加一
- [ ] 提交信息符合 `type(scope): 简短说明` 格式

## 截图 / 录屏

<!-- 有 UI 改动时贴图；没有就写「无」。 -->

## 需要 reviewer 特别关注的地方

<!-- 例如某段取舍、某个边界条件、某个还没想好的地方。没有就写「无」。 -->
