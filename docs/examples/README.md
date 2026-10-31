# 边界样本库

12 条边界通知，用来验证「日期不猜、证据必须逐字存在」这些规则在真实压力下是否成立。

```bash
npm run test:replay            # 离线：不请求模型，几秒钟跑完，可进 CI
npm run test:replay -- --live  # 在线：真调模型抽检，断言失败只警告
npm run test:replay -- --only=G3
```

## 为什么是「断言」而不是「快照」

`expected.json` 里存的不是「模型应该返回什么」，而是两样东西：

1. `modelOutput` —— **模型可能会返回什么**（可以是正确的，也可以是错的、被注入的、格式违规的）；
2. `assert` —— **服务端应该怎么处置它**。

回放时把 `modelOutput` 直接喂进真实的解析管线（`parseNotification`），跳过模型调用，只跑 Zod 契约校验、日期换算、证据校验、warning 生成。所以测的是**校验逻辑**，不是模型水平：

- 模型措辞天天变，快照式期望会天天红；
- 行为契约（该空就得空、该拒就得拒）是稳定的，可以当回归线。

`--live` 模式反过来，用真实模型跑一遍，看模型本身有没有退步。那个模式下断言失败只记警告，因为同一句话可以有多种合法表达，措辞差异不该卡住发布。

## 样本清单

| 编号 | 场景 | 关键断言 |
|---|---|---|
| [G1](G1-activity-only/) | 只有活动时间，没有报名截止 | `deadline` = null，活动时间照填 |
| [G2](G2-cross-year/) | 「下周三」跨年（参考日 2026-12-30） | 代码换算为 2027-01-06，覆盖模型给错的 01-05 |
| [G3](G3-vague-time/) | 「月底前」 | 判空 + 提示，不折算成 10-31 |
| [G4](G4-time-only/) | 只有钟点 23:59，没有日期 | 判空，不套用参考日期 |
| [G5](G5-date-only/) | 只有日期，没有钟点 | 判空，不补 23:59 |
| [G6](G6-signup-vs-event/) | 报名截止 11-03 与竞赛开始 11-08 | 两字段分离，不互相顶替 |
| [G7](G7-fabricated-date/) | 模型编造原文没有的日期 | 502 `INVALID_MODEL_OUTPUT` |
| [G8](G8-two-deadlines/) | 同一通知两个截止时间 | 忠实执行证据，不替用户裁决哪个是死线 |
| [G9](G9-prompt-injection/) | 正文夹带提示注入 | 即便注入成功也 502（附两版迭代记录） |
| [G10](G10-oversize-text/) | 超过 50000 字 | 400，且不发模型请求 |
| [G11](G11-weekday-miscomputed/) | 「本周五」被模型算成周六 | 以代码换算为准 |
| [G12](G12-contract-violation/) | `type` 返回枚举外取值 | 502，契约不放宽 |
| [G13](G13-long-but-valid/) | 4.8 万字，截止时间在全文最后一句 | 放行并正确取出，与 G10 成对守住上限 |

## 每条样本的三个文件

```
G3-vague-time/
  input.md        通知原文（会作为 text 传入）
  expected.json   modelOutput（喂给管线的模型输出）+ assert（期望的服务端行为）
  notes.md        这条为什么值得测、通过判据是什么、踩过什么坑
```

## 新增一条样本的步骤

1. 建目录 `G14-<场景英文短名>/`，写 `input.md`；
2. `expected.json` 里先填一个**故意有问题的** `modelOutput`（这才是边界样本的意义）；
3. `assert` 只写行为契约：`deadline` / `eventStartTime` / `actionTitle` / `type` 的期望值、`warningsContain`、或 `error.status + error.code`；
4. `npm run test:replay` 跑到绿；
5. `notes.md` 写清「测什么 / 为什么值得测 / 通过判据」。

支持的断言字段：`deadline`、`eventStartTime`、`actionTitle`、`type`、`warningsContain`、`warningsMin`、`error { status, code, messageContains }`。

## 与 `sample-notice.md` 的区别

`sample-notice.md` 和 `parse-result.json`、`interpret-result.json` 是**真实模型调用的原始输出**，用来给 README 做效果展示，也是「我们真的跑过」的凭据。它们不参与回归，因为里面是某一次的具体措辞。

边界样本库是**回归网**，跑的是逻辑，不是那一版模型的措辞。
