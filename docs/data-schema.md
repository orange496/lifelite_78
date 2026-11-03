# 数据结构与存储约定

LifeLite 没有后端，所有数据都在浏览器的 `localStorage` 里。这份文档说明每个键存什么、字段的含义与约束，以及导入导出文件的格式。改数据结构前请先读[版本迁移](#六版本迁移)一节。

- 代码入口：[`js/storage.js`](../js/storage.js)（唯一的读写入口）
- 数据规则：级联删除、幂等、只加不减，详见 [`design-decisions.md`](design-decisions.md)

## 一、存储键一览

所有键统一加 `lifelite.` 前缀，避免和同域的其他页面冲突。

| 键 | 内容 | 值类型 | 默认值 |
| --- | --- | --- | --- |
| `lifelite.goals` | 全部目标 | `Goal[]` | `[]` |
| `lifelite.tasks` | 全部任务 | `Task[]` | `[]` |
| `lifelite.checkins` | 打卡记录 | `{ [YYYY-MM-DD]: true }` | `{}` |
| `lifelite.profile` | 经验、等级、连续天数 | `Profile` | 见下 |
| `lifelite.meta` | 结构版本与最后写入时间 | `Meta` | 自动创建 |
| `lifelite.backup` | 导入前自动保存的旧数据 | 导出文件同构 | 无 |
| `lifelite.corrupt` | 读取时发现损坏的原始文本（留档排查用） | `{ [name]: raw }` | 无 |

> 写入只走 `LL.Storage.write()` / `writeGoals()` / `writeTasks()` / `writeCheckins()` / `writeProfile()`，它们会在同一次操作里更新 `lifelite.meta.lastModified`。不要在业务代码里直接调 `localStorage.setItem`。

## 二、Goal（目标）

```json
{
  "id": "g_1a2b3c",
  "title": "通过大学英语六级",
  "desc": "每天 30 分钟听力，周末做一套真题。",
  "due": "2026-12-20",
  "color": "green",
  "status": "active",
  "createdAt": "2026-11-03T23:24:49.000+08:00"
}
```

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | string | `g_` + 随机串，创建后不变 |
| `title` | string | 必填，去首尾空格后 1–60 字；重名允许保存但会提示 |
| `desc` | string | 可空，最长 300 字 |
| `due` | string \| null | `YYYY-MM-DD`，可以早于今天（卡片标红提示已逾期） |
| `color` | string | `blue` / `green` / `amber` / `violet` / `slate`，默认 `blue` |
| `status` | string | `active` 进行中 / `done` 已完成 / `archived` 已归档 |
| `createdAt` | string | 带时区的 ISO 时间，列表按它倒序（新的在上） |

状态说明：

- `active`：出现在主列表，可编辑、完成、归档、删除。
- `done`：显示置灰 + 勾选，可以「重新打开」回到 `active`。
- `archived`：移出主列表，在「已归档」页可以恢复；**已归档的目标不能直接删除**，要么恢复，要么「彻底删除」。

## 三、Task（任务）

```json
{
  "id": "t_4d5e6f",
  "goalId": "g_1a2b3c",
  "title": "精听一套六级听力真题",
  "priority": "high",
  "estimate": 60,
  "due": "2026-11-08T21:00",
  "done": false,
  "completedAt": null,
  "createdAt": "2026-11-03T23:30:00.000+08:00"
}
```

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | string | `t_` + 随机串 |
| `goalId` | string | 必填，必须指向一个存在的目标；删除目标时任务级联删除 |
| `title` | string | 必填，1–80 字 |
| `priority` | string | `high` / `medium` / `low`，默认 `medium` |
| `estimate` | number \| null | 分钟数，只能取 `15` / `30` / `60` / `90` / `120`，决定经验值 |
| `due` | string \| null | `datetime-local` 的值（`YYYY-MM-DDTHH:mm`），过期标红 |
| `done` | boolean | 是否完成 |
| `completedAt` | string \| null | 完成时间；**它与 `done` 必须同时成立**（写入时强制对齐） |
| `createdAt` | string | 创建时间 |

任务列表的排序规则（`LL.Tasks.compare`）：

1. 未完成在前，已完成沉底；
2. 已完成之间按 `completedAt` 倒序（最近完成的在上）；
3. 未完成按优先级 `high → medium → low`；
4. 同优先级按截止时间升序，没有截止时间的排在同优先级最后；
5. 仍相同则按 `createdAt` 倒序。

**幂等的判据是 `completedAt` 是否为空**：完成时写入 `completedAt`，撤销时清空。重复点击完成不会重复发经验（见 `Profile.addExp` 的去重）。

## 四、Checkins（打卡）

```json
{
  "2026-11-01": true,
  "2026-11-02": true,
  "2026-11-03": true
}
```

- 键是**本机时区**的 `YYYY-MM-DD`，每天最多一条，重复打卡直接返回 `reason: 'already'`。
- 值是 `true`，只记录「这一天打过卡」，不记录次数。
- 连续天数不落盘为真值，而是每次从这张表现算（`Profile.currentStreak`），避免跨天显示过期。
- 热力图展示最近 8 周 × 7 天，按周排列，今天描边。

## 五、Profile（经验与等级）

```json
{
  "exp": 250,
  "level": 3,
  "streak": 5,
  "lastCheckin": "2026-11-03",
  "streakBonusCount": 0,
  "expLog": [
    { "at": "2026-11-03T09:12:00.000+08:00", "amount": 20, "source": "task", "refId": "t_4d5e6f" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `exp` | 累计经验，只增不减 |
| `level` | 由 `exp` 推导（读取时重新计算），等级只升不降 |
| `streak` | 最近一次打卡后的连续天数快照，仅用于展示兜底 |
| `lastCheckin` | 最近一次打卡日期 |
| `streakBonusCount` | 已经领过几次「连续 7 天」奖励，防止重复发放 |
| `expLog` | 经验流水，最多保留 300 条（`CONST.MAX_EXP_LOG`） |

`expLog` 的 `source` 取值：`task`（完成任务）、`goal`（完成目标）、`checkin`（每日打卡）、`streak`（连续打卡奖励）。`refId` 是去重键：同一 `(source, refId)` 只发一次经验。

经验与等级公式：

| 事件 | 经验 |
| --- | --- |
| 完成小任务（15 / 30 分钟） | +10 |
| 完成中任务（60 分钟，未填时长也按此） | +20 |
| 完成大任务（90 / 120 分钟） | +30 |
| 每日打卡 | +5 |
| 完成一个目标 | +50 |
| 连续打卡每满 7 天 | +20 |

升到下一级所需经验 = `100 + (n - 1) × 50`；累计门槛 L1 = 0、L2 = 100、L3 = 250、L4 = 450、L5 = 700。称号依次为起步者、学习者、坚持者、自律者、掌控者（超过 5 级继续沿用掌控者）。

## 六、Meta（元信息）

```json
{ "schemaVersion": 1, "lastModified": "2026-11-03T23:31:02.000+08:00" }
```

- `schemaVersion` 是**结构版本**，与导出文件的 `version`（导出格式版本）不是一回事。
- 启动时 `Store.init()` 读取 `schemaVersion`，低于当前版本走迁移，高于当前版本（用户从新版本降级）不破坏数据，只提示。

### 版本迁移

| 场景 | 处理 |
| --- | --- |
| 无 `lifelite.meta` | 视为全新用户，写入当前版本 |
| `schemaVersion` 低于当前 | 执行 `migrate()` 中的迁移步骤，成功后写入新版本号 |
| `schemaVersion` 高于当前 | 只读提示「数据来自更新的版本」，不写入、不清空 |
| 迁移抛错 | **整段丢弃回退到空数据并提示**，同时把原始文本存进 `lifelite.corrupt` 以便排查 |
| 某个键 JSON 解析失败 | 该键回退默认值，原文留档 `lifelite.corrupt`，通过 `takeNotice()` 提示用户 |

## 七、导入 / 导出文件格式

导出文件名：`lifelite-backup-YYYYMMDD.json`（例：`lifelite-backup-20261103.json`）。

```json
{
  "app": "LifeLite",
  "version": 1,
  "schemaVersion": 1,
  "exportedAt": "2026-11-03T23:31:02.000+08:00",
  "goals": [],
  "tasks": [],
  "checkins": {},
  "profile": { "exp": 0, "level": 1, "streak": 0, "lastCheckin": null, "expLog": [] }
}
```

导入流程（`Store.importText()` 只解析校验，`Store.applyImport()` 才写入）：

1. 文件大小超过 4 MB 直接拒绝；不是合法 JSON 拒绝；
2. 缺少 `version`、`version` 高于支持版本、`goals` / `tasks` 不是数组，都拒绝；
3. 逐条校验：目标的 `id` / `title`，任务的 `id` / `goalId` / `title` / `done` 等必须齐全；
   只要有一条不合格就**整体拒绝**，不做部分导入；
4. 校验任务引用的 `goalId` 必须能在同一份文件里找到，否则视为脏数据拒绝；
5. 通过后弹确认框，明确告知「将导入 N 个目标、M 个任务」，用户确认后**覆盖**当前数据；
6. 覆盖前先把现有五个键原样存进 `lifelite.backup`，导入后提示导入的条数。

失败时统一文案：`文件格式不对，需要 LifeLite 导出的备份文件。` 更具体的原因放在次行说明里。

## 八、容量与边界

- Chrome 的 `localStorage` 单域上限约 5 MB。按单条目标/任务几百字节估算，几千条以内没有问题；超过时写入会失败，界面会提示检查浏览器存储设置。
- 导入上限 4 MB 是给「手工编辑过的巨大 JSON」留的安全阀。
- 日期一律按**本机时间**计算。已知问题：手改系统时间、跨时区旅行时，「今天」可能跳变，打卡与连续天数不做特殊处理（验收标准也不要求）。
- 深色模式是可选功能，不在数据结构里留字段。
