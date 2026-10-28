# 通知智析 · 微信接入设置指南（M0 验证阶段 · r5）

> ⚠️ 本文公网入口部分（cloudflared 临时域名）已作废：未认证企业微信只接受公网 IP 或本主体备案域名，第三方隧道域名必然报 -50025。
> 请改用 [WECHAT_A0_SETUP.md](WECHAT_A0_SETUP.md)。本文其余部分（凭据获取、白名单、真实转发核对）仍然有效。

本指南对应 TASK-001 M0。目标：证明"真实微信转发 → 本机取得消息/文件 → 微信回复"链路可达。

当前不包含 OCR、模型解析、多通知拆分、账户系统等后续功能。

## ⚠️ 先决条件

源码必须通过本地测试才能启动公网隧道。未经代码复核通过不接公网。

```bash
cd daima
npm run test:wechat-gate
# 必须全部通过
```

## 步骤概览

1. 完成程序自检
2. 开通微信客服（仅用户可操作）
3. 填写本机配置文件
4. 获取公网地址
5. 配置后台回调并完成 URL 校验
6. 测试发送者入白名单
7. 真实转发验证（含原件核对）
8. 公网可达性检查

## 1. 程序自检

```bash
cd daima

# 安装依赖（若尚未安装）
npm install

npm run test:wechat-gate
# 期望：17/17 pass
```

## 2. 开通微信客服

> ⚠️ 以下步骤只能由用户本人完成。

### 2.1 进入后台

1. 打开 [微信客服后台](https://kf.weixin.qq.com/)
2. 微信扫码登录
3. 按后台指引完成企业微信注册（可能需要营业执照等主体信息）
4. 在"客服账号"中创建至少一个客服账号

> **注意**：创建客服账号不等于 API 权限已开通；需在"开发配置"页面确认能看到"接收消息服务器"配置入口。

### 2.2 获取必要信息

进入后台后，依次记录以下信息（不要发到聊天或 Markdown 中）：

| 信息 | 后台位置 | 环境变量 |
|------|---------|-------------|
| 企业 ID | 我的企业 → 企业信息 | `WECOM_CORP_ID` |
| 微信客服 Secret | 后台"开发配置"页面（具体位置以后台实际显示为准） | `WECOM_SECRET` |
| Token（自定义） | 开发配置 → 接收消息服务器 → 自己填写 3-32 位 | `WECOM_TOKEN` |
| EncodingAESKey | 同上 → 点击"随机生成"（43 位） | `WECOM_ENCODING_AES_KEY` |
| 客服账号 ID | 微信客服 → 客服账号 → 详情 | `WECOM_OPEN_KFID` |

**先不提交后台**：Token 和 EncodingAESKey 先在本地配置文件中填写，等步骤 5 再回后台提交。

## 3. 填写本机配置文件

> ⚠️ **先检查文件是否已存在，勿用模板覆写已填写的配置。** 若已存在（如已填写过密钥），直接编辑，不要重新复制。

```bash
cd daima

# 仅在文件不存在时才创建（避免覆写已填写的密钥）
[ -f .env.wechat.local ] || cp .env.wechat.example .env.wechat.local
```

编辑 `.env.wechat.local`，填写步骤 2 获取的 5 个值：

```
WECOM_CORP_ID=ww_你的企业ID
WECOM_SECRET=你的Secret
WECOM_TOKEN=你自定义的Token
WECOM_ENCODING_AES_KEY=后台生成的43位Key
WECOM_OPEN_KFID=你的客服账号ID
```

`WECHAT_GATE_PUBLIC_URL` 和 `WECHAT_GATE_TESTER_IDS` 先留空，后续步骤再填写。

重启网关使配置生效：`Ctrl+C` 后 `npm run dev:wechat-gate`。

## 4. 获取公网地址

使用 Cloudflare Quick Tunnel（免费，无需注册）。

### 4.1 下载 cloudflared

从 [Cloudflare 官方](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) 下载 Windows (amd64) 版本。

放入 `daima/.tools/cloudflared.exe`（`.tools/` 已加入 `.gitignore`，不会提交到 Git）。

### 4.2 启动

```powershell
# 终端 1：启动微信网关
npm run dev:wechat-gate

# 终端 2：启动公网隧道
.\daima\.tools\cloudflared.exe tunnel --url http://127.0.0.1:3002
```

成功后显示：

```
https://xxxx-xxxx-xxxx.trycloudflare.com
```

### 4.3 更新配置

编辑 `daima/.env.wechat.local`，加入：

```
WECHAT_GATE_PUBLIC_URL=https://xxxx-xxxx-xxxx.trycloudflare.com
```

重启网关。

## 5. 配置后台回调并完成 URL 校验

回到 [微信客服后台](https://kf.weixin.qq.com/) → 开发配置 → 接收消息服务器：

- **URL**: `https://你的域名.trycloudflare.com/wechat/callback`
- **Token**: 步骤 2 中自定义的
- **EncodingAESKey**: 步骤 2 随机生成的 43 位

点击"保存"——微信后台会 GET 请求验证。如果失败：

| 错误 | 可能原因 |
|------|---------|
| 连接超时 | cloudflared 未运行或域名变化 |
| URL 校验失败 | Token/EncodingAESKey 不一致，或使用了三参数签名（本程序使用四参数签名） |
| 解密失败 | EncodingAESKey 填错、含多余空格 |

临时域名每次重启 tunnel 后变化，需同步更新后台 URL 和 `.env.wechat.local`。

## 6. 测试发送者入白名单

### 6.1 建立客服会话

通过后台提供的官方入口建立会话（如客服链接、二维码等，具体入口以后台"客服账号 → 会话入口"为准）。

### 6.2 获取发送者 ID

查看 `daima/.local/wechat-gate/` 中的 `state.db` SQLite 数据库，查询 `raw_events` 表：

```sql
SELECT sender_id, event_type FROM raw_events ORDER BY created_at DESC LIMIT 10;
```

或查看数据库中的 `events` 表获取 `sender_id`。

### 6.3 加入白名单

编辑 `.env.wechat.local`：

```
WECHAT_GATE_TESTER_IDS=你的发送者ID
```

**重启网关**。再次发送消息，应收到自动回复。

## 7. 真实转发验证

对每种材料类型：从微信聊天窗口直接转发到客服会话。

| 材料类型 | 操作 | 验证点 |
|---------|------|--------|
| 文字 | 直接发送 | 收到回执 |
| 图片 | 相册选择/拍照发送 | 收到回执 + 核对 `.local/wechat-gate/media/` 文件 |
| PDF 文件 | 聊天窗口 → + → 文件 → 选择 PDF | 同上 |
| DOCX 文件 | 同上 | 同上 |
| 公众号文章 | 转发文章链接到客服 | 收到回执（含链接） |
| DOC 文件 | 同 PDF | 记录可用性 |
| TXT 文件 | 同 PDF | 记录可用性 |

每项记录到证据矩阵。

**不替代规则**：不能用"另行下载再上传"代替真实转发。微信侧找不到客服或文件不能转发时，如实记录。

## 8. 公网可达性检查

用另一部手机（或邀朋友帮忙）用移动网络访问：

```
https://你的域名.trycloudflare.com/
```

应看到"通知智析 · 微信接入 · M0 · r3"。

## 停止与回收

- **停止网关**：Ctrl+C 终端 1
- **停止隧道**：Ctrl+C 终端 2
- **临时域名**：停止隧道后即失效
- **本地存储**：`daima/.local/wechat-gate/` — SQLite 数据库 + media 目录
- **清空存储**：不建议用 `rm -rf` 直接删除；如需清理，保持数据库文件以保留去重状态

## M0 完成条件

- [x] 程序自检通过（17/17）
- [ ] 微信客服开通资格已验证
- [ ] 公网地址已取得并通过微信回调校验
- [ ] 文字、图片、PDF、DOCX、公众号文章真实转发及原件/回执已验证
- [ ] 受邀者移动网络可访问验证页
- [ ] DOC/TXT 可用性已记录