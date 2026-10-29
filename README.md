# 通知智析

把群通知、公众号文章、说明文件解析成结构化的待办事项：提取时间、地点、截止要求，生成可提醒的任务。

面向学校、社团、社区这类「通知多、格式乱、容易漏」的场景。全部在本机运行，数据不出本机，模型密钥也只存在本机。

## 能做什么

| 能力 | 说明 |
|---|---|
| 通知解析 | 粘贴文字或公众号链接，提取标题、类型、截止时间、活动时间、地点、对象、要求、联系人、链接 |
| 多材料合并 | 群通知 + PDF/Word 说明文件 + 公众号文章一起解析，冲突项会明确提示而不是替你取舍 |
| 配图识别 | 公众号文章里的海报、截图，用视觉模型读出图中文字并合并进正文 |
| 深度解读 | 分析容易忽略的前置条件、时间先后、资格限制，每条结论都要求引用原文 |
| 通知生成 | 填表单向，生成格式规范的通知文案 |
| 双知识库 | 个人知识库（只有自己可见）与应用知识库（全员共享），解析时按权限检索并标注引用来源 |
| 提醒 | 一次性或周期提醒，支持稍后提醒、语音、浏览器通知 |

## 快速开始

### 方式一：下载即用（Windows，不需要安装 Node）

到 [Releases](https://github.com/fynn7r/notification-analysis1.0/releases) 下载 `notizhi-portable-win-x64.zip`，解压后双击「启动.bat」，浏览器会自动打开。压缩包里已经带好 Node 运行时，整台机器不用装任何东西，换电脑也是复制文件夹即可。

首次启动会在窗口里打印管理员账号和密码，**只显示一次**。

### 方式二：从源码运行

需要 Node.js 22.18 或更高版本（含 24；服务端直接导入 .ts 契约文件，依赖 22.18 起默认开启的类型剥离）。

```bash
npm install
npm start
```

打开终端里提示的地址（默认 http://127.0.0.1:8001）。

首次启动会自动完成三件事，不需要额外命令：

1. 从 `.env.example` 生成 `.env.local`
2. 构建前端（约 20-40 秒，之后不再重复）
3. 创建管理员账号并在终端打印初始密码 —— **只显示一次，请立即记录**

## 填写模型密钥

页面里打开「我的 → 模型接入」，填三样：

| 项 | 示例 |
|---|---|
| API 基础地址 | `https://api.deepseek.com` |
| API 密钥 | 服务商控制台创建 |
| 默认模型 | `deepseek-flash` |

支持任何 OpenAI 兼容的 Chat Completions 接口。保存后立即生效，不必重启。

> 没有密钥也可以打开页面、浏览已保存的待办，但真实解析会明确提示未配置，不会返回假结果。

### 配图识别（可选）

公众号文章里的图默认只留 `[图片 N]` 占位符并提示「未读取图中文字」。要真正读图，在 `.env.local` 里指定一个支持视觉的模型：

```ini
AI_VISION_MODEL=qwen3-vl-plus
```

`deepseek-flash`、`qwen3-vl-plus` 等均可。用同一家的模型时不必再填地址和密钥；跨服务商时可单独指定 `AI_VISION_BASE_URL` / `AI_VISION_API_KEY`。留空即关闭，不影响正文解析。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm start` | 单端口启动（前端 + API），日常用这个 |
| `npm run dev:standalone` | 开发模式，热更新，前端 8001 + API 3001 |
| `npm run test:api` | 接口与业务逻辑测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | 类型检查 + ESLint |
| `npm run build:standalone` | 只构建前端产物到 `dist-standalone/` |
| `npm run build:portable` | 打包 Windows 便携版 zip 到 `dist-portable/`（内含 Node 运行时） |
| `npm run admin:knowledge` | 账号管理（`list` 查看、`invite` 生成邀请码） |
| `npm run test:browser` | Playwright 浏览器端到端测试（跑开发服务器，改代码即时生效） |
| `npm run test:browser:prod` | 同上，但跑构建产物（与 `npm start` 完全一致，上线前用它回归） |

## 数据存在哪

| 内容 | 位置 | 备份建议 |
|---|---|---|
| 账号、知识库、邀请码 | `.local/knowledge/knowledge.db` | 复制整个 `.local/` 目录 |
| 模型密钥与端口配置 | `.env.local` | 含密钥，单独妥善保存 |
| 待办、提醒、历史、个人设置 | 浏览器 localStorage | 换浏览器或清缓存会丢失 |

`.gitignore` 已排除 `.env.local`、`.local/`、`dist-standalone/`，误提交不会泄露密钥和业务数据。

## 已知限制

- **扫描版 PDF 读不出文字**。需要文字层，纯图片 PDF 请先 OCR。
- **合计 20000 字上限**。原文优先占用，参考材料按顺序填充，装不下的会明确提示用了多少字。
- **公众号文章可能被风控拦截**。遇到「环境异常」验证页时会提示手动粘贴正文，不会静默失败。
- **公众号只支持 `mp.weixin.qq.com`**。其他链接（校内系统、腾讯文档）通常需要登录，抓回来是登录页，因此直接拒绝而不盲目抓取。
- **提醒依赖页面处于打开状态**。网页应用在完全关闭时无法响铃，这是浏览器能力边界，不是配置问题。
- **日期证据必须逐字出现在原文中**。模型若引用不到原文片段，会判定解析失败而不是编造时间。

## 技术栈

React 19 + TypeScript + Vite 8 + Tailwind v4 + shadcn/ui + Zod 4；服务端为 Node 原生 `http`，数据库用内置 `node:sqlite`（FTS5 全文索引），无外部数据库依赖。

## 目录结构

```
server/            服务端（API、解析、知识库、静态托管）
  index.mjs        单端口服务入口
  parse-service.mjs  通知解析（含提示词与校验）
  article-extract.mjs 公众号正文提取
  vision-service.mjs  配图文字识别
  knowledge/       账号、权限、检索
shared/            前后端共享的 Zod 契约与日期工具
src/               前端（pages / components / hooks / lib）
scripts/           启动、管理、验证脚本
```

## 开发约定

- 新增页面放在 `src/pages/<PageName>/PageName.tsx`，并在 `src/app.tsx` 的 `<Routes>` 内注册
- `BrowserRouter` 已在入口配置，`app.tsx` 内不要再包一层 Router
- 路径别名：`@/` → `src/`，`@shared/` → `shared/`
- 主题色定义在 `src/index.css`，通过 CSS 变量 + `@theme inline` 接入 Tailwind
- 改动后至少跑一遍 `npm run lint` 与 `npm run test:api`

## 许可证

MIT，见 [LICENSE](LICENSE)。
