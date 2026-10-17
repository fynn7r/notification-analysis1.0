# 通知智析 - 需求拆解文档

## 产品概述

- **产品类型**: 轻量智能通知解析工具应用
- **场景类型**: <scene_type>prototype-app</scene_type>
- **目标用户**: 大学生、社区成员、职场人士等需要处理大量群通知并进行优先级判断的人群
- **核心价值**: 粘贴群通知原文，智能提取关键信息、对照规则库判断重要程度、一键转为提醒事项，让用户不再错过重要通知
- **界面语言**: 中文
- **主题偏好**: 浅色（用户要求"简洁干净清爽"）
- **导航模式**: 路径导航
- **导航布局**: Topbar（消费者前台类轻量工具，顶部导航即可）

---

## 页面结构总览

> **说明**：此表为页面生成的唯一数据源，包含所有页面（一级+二级）

| 页面名称 | 文件名 | 路由 | 页面类型 | 入口来源 |
|---------|-------|------|---------|---------|
| 智能解析（首页） | `ParsePage.tsx` | `/` | 一级 | 导航 |
| 规则库 | `RulesPage.tsx` | `/rules` | 一级 | 导航 |
| 提醒事项 | `RemindersPage.tsx` | `/reminders` | 一级 | 导航 |
| 历史记录 | `HistoryPage.tsx` | `/history` | 一级 | 导航 |

> **页面精简说明**：个人目标标签设置合并进规则库页（属于规则配置的一部分）；摘要卡片功能在解析结果页内完成（非独立页面）；首次使用引导以全局弹窗/引导浮层形式实现，不单独成页。

---

## 页面布局建议

- **布局模式**: 单栏为主，解析页采用"上下分区"（上方输入区 + 下方结果承载区），桌面端解析结果可展开为左右分栏对照
- **视觉重心**: 输入区（首屏大粘贴框）为第一视觉重心，解析结果卡片为第二重心
- **结果承载区**: 解析结果以结构化卡片形式展示（通知类型、时间、地点、重要程度、加分匹配、摘要）；初始态为**示例占位**（内置演示场景的示例通知解析结果，引导用户体验）
- **源材料承载**: 解析结果卡片内保留通知原文折叠区，用户可展开对照查看

---

## 插件规划

| 插件实例名称 | 基于官方插件 | 业务用途 | 输出模式 | 所属页面 |
|------------|-----------|---------|---------|---------|
| 通知结构化解析 | `ai-text-to-json` | 从粘贴的通知原文中提取关键信息并结构化输出（类型、时间、地点、要求等字段） | unary | 智能解析页 |
| 规则库匹配分析 | `ai-categorization` | 将解析出的通知与规则库中的条目进行匹配，判断对应加分项目、分值及重要程度 | unary | 智能解析页 |
| 规则文档解析 | `ai-doc-parser` | 解析用户导入的规则文件（如综测加分细则 PDF/Word），提取规则条目 | unary | 规则库页 |
| 通知摘要生成 | `ai-text-summary` | 生成精简的通知摘要卡片文本（类型+重要程度+截止时间+加分点） | unary | 智能解析页 |

---

## 导航配置

- **导航布局**: Topbar（顶部固定，简洁清爽）
- **导航项**（仅一级页面）:

| 导航文字 | 路由 | 图标(可选) |
|---------|------|-----------|
| 智能解析 | `/` | Sparkles |
| 规则库 | `/rules` | BookOpen |
| 提醒事项 | `/reminders` | Bell |
| 历史记录 | `/history` | History |

---

## 数据来源声明

| 数据/操作 | 来源类型 | 实现要求 | mock 兜底 |
|---|---|---|---|
| 通知原文粘贴输入 | demo-mock | 文本输入框 state 管理，用户手动粘贴 | 内置 1 条示例比赛通知（source='mock'） |
| 通知结构化解析 | real-plugin | 调 `ai-text-to-json` 实例，传入用户粘贴的通知原文，输出结构化字段（类型/时间/地点/要求等） | 失败提示（toast "解析失败，请重试"） |
| 规则库文件导入 | real-file + real-plugin | File API 接收用户上传的规则文件，调 `ai-doc-parser` 实例解析文件内容，提取规则条目后保存 | 内置 1 份示例综测加分规则（source='mock'），插件失败时 toast 提示 |
| 规则库文本粘贴 | local-persist | 用户直接粘贴规则文本，保存至 localStorage | 无 |
| 规则匹配与重要程度判断 | real-plugin | 调 `ai-categorization` 实例，传入解析后的通知结构化数据 + 规则库内容，输出匹配的加分项目、分值及重要程度理由 | 失败提示（toast "规则匹配暂不可用"） |
| 通知摘要生成 | real-plugin | 调 `ai-text-summary` 实例，传入解析结果 + 匹配结果，输出精简摘要文本 | 失败提示（toast "摘要生成失败"） |
| 提醒事项管理 | local-persist | localStorage key=`__app_notizhi_reminders`，支持增删改查、标记完成 | 初始 0 条 |
| 历史解析记录 | local-persist | localStorage key=`__app_notizhi_history`，支持搜索、筛选、删除 | 初始 1 条示例记录（source='mock'） |
| 个人目标标签 | local-persist | localStorage key=`__app_notizhi_goals`，用户可添加/删除目标标签 | 初始预置 ["提高综测"] |
| 摘要复制/分享 | import-export | `navigator.clipboard` 复制摘要文本 | 无 |

> 插件能力不可 mock，所有 real-plugin 行的 mock 兜底均为失败提示，不提供伪造解析结果。演示场景通过 source='mock' 的预置静态数据实现首次体验。

---

## 功能列表

### 页面：智能解析（首页）

- **页面目标**: 用户粘贴通知原文，一键智能解析，查看结构化结果、规则匹配分析、重要程度判断，并生成提醒或摘要
- **功能点**:
  - **大粘贴框输入**: 首屏居中大文本域，支持粘贴通知原文，占位文案引导"粘贴班级群/社区群通知原文..."，右侧"智能解析"主按钮
  - **智能解析通知**: 点击解析按钮后，调用通知结构化解析插件，输出通知类型、报名截止时间、活动时间、提交位置/地点、参加对象、作品要求、联系方式、相关链接等结构化字段；解析过程显示加载动画
  - **规则库自动匹配**: 解析完成后自动调用规则匹配分析插件，对照规则库找出对应加分项目、分值、匹配依据，展示"能加多少分、属于哪类、是否值得参加"
  - **重要程度展示与调整**: 自动给出高/中/低重要程度及判断理由（时间紧迫/涉及加分/必须完成等），用户可点击重要程度标签手动调整
  - **一键生成提醒事项**: 解析结果卡片底部"添加提醒"按钮，弹出选择提醒时间（截止前2天/1天/3小时/自定义），确认后写入提醒列表
  - **生成摘要卡片**: 点击"生成摘要"调用摘要插件，输出精简摘要（类型+重要程度+截止时间+地点+加分点），支持一键复制

### 页面：规则库

- **页面目标**: 管理个人规则库文件和文本，设置个人目标标签，为智能解析提供参考依据
- **功能点**:
  - **导入规则文件**: 支持拖拽或点击上传规则文件（PDF/Word/TXT），调用规则文档解析插件提取规则条目，解析后列表展示
  - **粘贴规则文本**: 提供文本输入区，用户可直接粘贴规则内容，保存为规则库条目
  - **规则条目管理**: 列表展示所有规则条目（来源、类型、内容摘要），支持删除单条或清空规则库
  - **个人目标标签设置**: 标签输入框，用户可添加/删除目标标签（如提高综测、保研、评优、求职），目标标签参与重要程度计算权重
  - **示例规则预置**: 首次打开内置一份示例"综测加分规则"（标注为示例），用户可删除后导入自己的规则

### 页面：提醒事项

- **页面目标**: 查看和管理所有从解析结果生成的提醒事项，追踪截止状态
- **功能点**:
  - **提醒列表展示**: 按截止时间排序，卡片展示通知标题、类型、重要程度标签、截止倒计时（如"还有 2 天 3 小时"）
  - **临近截止醒目提示**: 截止时间小于 24 小时的提醒高亮显示（红色边框/背景），小于 3 小时标为"紧急"
  - **标记完成**: 每条提醒右侧勾选按钮，点击标记为已完成，完成项移至列表底部并置灰
  - **删除提醒**: 行操作菜单支持删除单条提醒，二次确认
  - **筛选视图**: 顶部 Tab 切换"全部 / 待办 / 已完成"

### 页面：历史记录

- **页面目标**: 浏览所有已解析过的通知，支持搜索和筛选，可快速查看详情或重新生成提醒
- **功能点**:
  - **历史列表**: 卡片列表展示所有解析记录（通知标题缩略、类型标签、重要程度、解析时间）
  - **搜索与筛选**: 顶部搜索框按标题/内容关键词搜索；类型筛选下拉（比赛竞赛/讲座分享/作业任务/缴费事务/活动会议/招募报名/其他）
  - **查看详情**: 点击历史卡片展开/跳转查看完整解析结果和规则匹配详情
  - **删除记录**: 支持单条删除和批量删除，二次确认

---

## 数据共享配置

| 存储键名 | 数据说明 | 使用页面 |
|---------|---------|---------|
| `__app_notizhi_rules` | 规则库条目列表，类型为 `IRule[]` | 智能解析页、规则库页 |
| `__app_notizhi_goals` | 个人目标标签列表，类型为 `string[]` | 智能解析页、规则库页 |
| `__app_notizhi_reminders` | 提醒事项列表，类型为 `IReminder[]` | 智能解析页、提醒事项页 |
| `__app_notizhi_history` | 历史解析记录列表，类型为 `IHistoryItem[]` | 智能解析页、历史记录页 |

```ts
interface IRule {
  id: string;
  title: string;           // 规则名称，如"学科竞赛类加分"
  category: string;        // 分类，如"学科竞赛/文体活动/志愿服务"
  content: string;         // 规则内容详情
  score?: string;          // 对应分值或等级描述
  source: 'file' | 'text' | 'mock'; // 来源
  createdAt: number;
}

interface IParsedNotification {
  id: string;
  rawText: string;         // 原始通知文本
  type: '比赛竞赛' | '讲座分享' | '作业任务' | '缴费事务' | '活动会议' | '招募报名' | '其他';
  title?: string;          // 通知标题（AI 提取）
  registrationDeadline?: string; // 报名截止时间 ISO 字符串
  eventStartTime?: string; // 活动开始时间 ISO 字符串
  location?: string;       // 提交位置/地点
  targetAudience?: string; // 参加对象与条件
  requirements?: string;   // 作品要求与规范
  contact?: string;        // 联系方式/负责人
  links?: string[];        // 相关文件或链接
  importance: 'high' | 'medium' | 'low';
  importanceReason: string; // 重要程度判断理由
  matchedRules?: IMatchedRule[]; // 匹配的规则库条目
  summary?: string;        // 生成的摘要文本
  source: 'mock' | 'real';
  parsedAt: number;
}

interface IMatchedRule {
  ruleId: string;
  ruleTitle: string;
  category: string;
  score?: string;
  matchReason: string;     // 匹配依据说明
  worthAttending: boolean; // 是否值得参加
}

interface IReminder {
  id: string;
  notificationId: string;
  title: string;
  type: string;
  importance: 'high' | 'medium' | 'low';
  deadline: string;        // 截止时间 ISO 字符串
  remindAt: string;        // 提醒时间 ISO 字符串
  remindOffset: string;    // 提醒偏移描述，如"截止前2天"
  completed: boolean;
  createdAt: number;
}

interface IHistoryItem {
  id: string;              // 对应 IParsedNotification.id
  title: string;
  type: string;
  importance: 'high' | 'medium' | 'low';
  parsedAt: number;
  source: 'mock' | 'real';
}
```

---

## 首次使用引导与演示场景

- **引导形式**: 首次打开时以 3 步浮层引导（遮罩 + 气泡提示）
  1. 指向顶部"规则库"导航："先导入你的规则文件（如综测加分细则），AI 会自动对照判断重要程度"
  2. 指向首页大粘贴框："把群通知粘贴到这里，一键智能解析"
  3. 指向解析结果卡片底部："解析后可一键生成提醒，不错过任何截止日期"
- **内置演示数据**:
  - 规则库预置 1 条 `source: 'mock'` 的综测加分规则示例（含学科竞赛、文体活动、志愿服务等分类和对应分值）
  - 历史记录预置 1 条 `source: 'mock'` 的比赛通知解析结果示例，用户可直接点开查看完整解析效果
  - 用户可随时删除示例数据，不影响正常使用

-------

<scene_type>prototype-app</scene_type>

# UI 设计指南

## 1. 设计推导依据

- **参考意图**: Free Direction —— 用户仅描述功能需求与"简洁干净清爽"的调性要求，无参考图，由产品语义自主建立视觉方向
- **核心情绪 / 应用类型**: 轻量智能通知解析工具，面向学生与年轻用户，追求"打开即用、粘贴即得"的低压力高效感
- **独特记忆点**: 首页巨型粘贴框 + 智能解析后展开的"信息卡片瀑布"——从空白输入到结构化结果的一次顺滑展开，重要程度用柔和色块承载而非刺眼警示

## 2. Art Direction

- **方向名**: 柔白极简 · 智能便签
- **Design Style**: Muji 极简 + Soft Blocks 柔色块 —— 低干扰界面让通知内容本身成为主角，柔色块承载分类与重要程度，符合"清爽干净"的产品气质
- **DNA 参数**: 圆角 soft (rounded-lg / rounded-xl) / 阴影 subtle (shadow-sm) / 间距 standard (gap-4 / p-6) / 字体方向 现代无衬线中性 / 装饰手法 极细边界 + 低饱和柔色块 + 微渐变点缀
- **应用类型**: Tool —— 单页任务流为主，侧边栏承载历史与规则库导航

## 3. Color System

**色彩关系**: 雾蓝主色 + 同色系极浅反馈底 + 暖白工作台背景 + 低饱和柔色块（青/橙/绿）承载通知类型与重要程度
**配色设计理由**: 主色雾蓝传达智能、可靠与冷静，避免科技蓝的生硬；暖白背景降低长时间使用的视觉疲劳；重要程度与分类用柔色块区分，保持整体清爽不刺眼
**主色推导**: 从"智能解析 + 学生场景 + 清爽干净"出发，选择饱和度适中、偏冷调的雾蓝色作为 primary，既体现 AI 工具的精准感，又保留年轻产品的友好气质
**使用比例**: 65% 中性 / 28% 辅助柔色块 / 7% primary；primary 仅用于主按钮、解析状态、品牌标识，其余交互交由 accent 与中性色层级

| 角色 | CSS 变量 | Tailwind Class | HSL 值 | 设计说明 |
|---|---|---|---|---|
| bg | `--background` | `bg-background` | hsl(210 40% 98%) | 页面背景，偏冷的暖白 |
| card | `--card` | `bg-card` | hsl(0 0% 100%) | 卡片、输入框、结果面板 |
| text | `--foreground` | `text-foreground` | hsl(215 25% 18%) | 标题和正文，深灰蓝 |
| textMuted | `--muted-foreground` | `text-muted-foreground` | hsl(215 15% 50%) | 占位符、辅助说明、元信息 |
| primary | `--primary` | `bg-primary` / `text-primary` | hsl(210 70% 55%) | 雾蓝，主交互与品牌锚点 |
| primaryForeground | `--primary-foreground` | `text-primary-foreground` | hsl(0 0% 100%) | primary 上的文字 |
| accent | `--accent` | `bg-accent` | hsl(210 40% 94%) | hover/focus 浅底、选中态、骨架屏 |
| accentForeground | `--accent-foreground` | `text-accent-foreground` | hsl(215 25% 25%) | accent 上的文字与图标 |
| border | `--border` | `border-border` | hsl(214 20% 88%) | 输入框、卡片、菜单边界 |

**语义色提示**:
- 高重要度：bg hsl(10 85% 95%) / border hsl(10 70% 85%) / text hsl(10 70% 45%)——暖橘柔红，饱和度与 primary 对齐
- 中重要度：bg hsl(42 85% 94%) / border hsl(42 75% 80%) / text hsl(38 70% 40%)——暖黄，低饱和柔化
- 低重要度：bg hsl(140 40% 94%) / border hsl(140 30% 82%) / text hsl(140 40% 35%)——柔绿，与主色冷暖平衡
- 加分亮点：bg hsl(260 60% 95%) / border hsl(260 50% 85%) / text hsl(260 55% 45%)——淡紫，标记规则库匹配结果
- 成功/警告/错误：饱和度控制在 40-60% 区间，与 primary 饱和度 (70%) 相差不超过 15%

## 4. 字体与节奏

- **font-display**: Noto Sans SC —— 现代中文无衬线，清晰中性，适合工具类产品的标题与结果展示
- **font-body**: Noto Sans SC —— 同字族保证视觉统一，正文阅读舒适，中文显示效果优于 Inter
- **字号**: H1 text-3xl ~ text-4xl；H2 text-xl ~ text-2xl；body text-base；muted text-sm
- **圆角**: 中偏大 (rounded-lg / rounded-xl) —— 柔化输入框与卡片边角，呼应"清爽干净"的调性，避免过于圆润失去工具感

## 5. 全局布局契约

- **Reference Layout Use**: 按需求结构推导
- **Page / Section Order**: 首页（巨型粘贴输入 + 解析结果区） / 侧边栏（历史记录、规则库、设置） / 解析详情弹层或右侧滑出面板
- **Standard Content Zone**: Tool max-w-3xl + `mx-auto`——聚焦核心输入与解析结果，避免宽屏分散注意力
- **Shell / Frame Alignment**: 左侧导航 + 主内容区同宽对齐；内容区居中于可用空间，侧边栏固定宽度
- **Padding & Rhythm**: `px-4 md:px-6 py-8 md:py-12`，首屏输入框区域垂直留白加大，营造呼吸感
- **Full-bleed Zones**: 无全宽区块；全站内容受 Standard Content Zone 约束，保持聚焦感
- **Local Narrowing**: 设置页、规则库编辑页可收窄至 `max-w-2xl`，保持阅读舒适
- **Overflow Strategy**: 历史记录列表、规则库列表使用纵向滚动；标签筛选栏超出时 `overflow-x-auto`
- **Flexibility Boundary**: 允许移动端调整卡片间距与输入框高度；不允许改变主色、圆角系统与核心布局逻辑

## 6. 视觉与动效

- **装饰**: 极细边界 + 柔色块标签 + 微渐变按钮
- **阴影/边界**: 轻——卡片用 subtle shadow + 1px border，输入框聚焦时边框变为 primary 并加轻微光晕
- **动效**: 克制精致——解析结果卡片逐条淡入上滑 (stagger 80ms)；重要程度切换有柔和底色过渡；hover 状态 150ms ease-out

## 7. 组件原则

- 粘贴输入框是视觉核心，高度大于普通 textarea，placeholder 引导文案友好明确
- 解析结果以信息卡片组呈现，每张卡片对应一类信息（时间 / 地点 / 要求 / 加分匹配），左边缘用柔色条标识类别
- 重要程度用 Badge + 背景色双编码表达，不依赖纯颜色
- 规则库文件以卡片列表呈现，显示文件名、匹配次数、最后使用时间
- 空状态、加载态使用与主视觉一致的柔色块骨架屏，不退回到默认灰

## 8. Image Direction

- **Image Role**: 无强制图片需求，优先通过排版、柔色块与图标建立视觉记忆点
- **Image Art Direction**: 无强制图片需求
- **Image Prompt Keywords**: 无
- **Image Avoidance**: 避免通用商务人物素材、无意义抽象渐变、廉价科技感插图

## 9. Anti-patterns

- **Split personality**: 首页用大圆角、设置页用小圆角；全站统一 rounded-lg / rounded-xl 两级圆角
- **Phantom tokens**: 编造不存在的语义色变量；重要程度与加分匹配使用语义色提示中定义的 HSL，通过 bg/border/text class 组合实现
- **Default SaaS drift**: 回到默认深蓝按钮 + 紫色渐变 + 密集卡片；用雾蓝主色 + 柔白背景 + 疏朗间距守住清爽调性
- **Invisible interaction**: 只做 hover 不做 focus-visible；输入框、按钮、标签、列表项都要有清晰的键盘聚焦态（边框变色 + 浅光晕）
- **Mono-hue tyranny**: 主按钮、tab 激活、icon、边框、链接全用 primary；primary 仅用于 CTA 与解析状态，其余交互用 accent 与中性色层级
- **Status color drift**: 重要程度红黄绿饱和度飙到 90%+，与整体清爽感割裂；所有语义色饱和度控制在 40-70%，与 primary (70%) 对齐