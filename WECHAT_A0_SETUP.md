# 微信接入 A0 操作单（云服务器 + IP 形式回调）

> 取代 `WECHAT_SETUP.md` 里「获取公网地址 / 配置后台回调」两节 —— 那两节用的 trycloudflare 临时域名，对未认证企业必然报「回调域名校验失败 -50025」。
>
> **本阶段目标**：用现成 M0 网关证明三件事，一行业务代码都不改。
> 1. 未认证企业接受 `http://公网IP:8080/wechat/callback`
> 2. 服务器出口 IP 调用官方接口不报 `60020`
> 3. 80 端口对公网 IP 可达（公众号用，不通就放弃公众号）
>
> **A0 不通过，不要写 B 阶段任何代码。**

---

## 1. 买什么

| 项 | 要求 | 说明 |
|---|---|---|
| 类型 | 国内轻量应用服务器 | 腾讯云 / 阿里云皆可 |
| 配置 | 2 核 2G / 40GB 盘 / 3M 带宽 | 再低也能跑，2G 是舒适线 |
| 系统 | Ubuntu 24.04 LTS | 别用 CentOS 7（EOL） |
| 价格 | 新用户约 100 元/年 | 不需要买域名、不需要备案 |
| 关键 | **必须有固定公网 IP** | 回调 URL 就填这个 IP |

记下：`公网IP`、`root 或 ubuntu 账号密码/密钥`。

**安全组/防火墙放行**：

| 端口 | 来源 | 用途 |
|---|---|---|
| 22 | 你自己的宽带 IP | SSH，别开 0.0.0.0/0 |
| 8080 | 0.0.0.0/0 | 微信客服回调 + 预检 |
| 80 | 0.0.0.0/0 | 公众号（阶段 C 用） |

**不要**放行 3001 / 3002 / 8001。

---

## 2. 服务器初始化（一次性）

```bash
# 系统更新
sudo apt update && sudo apt upgrade -y

# Node 24（项目用 node:sqlite，必须 >= 22.5）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs nginx git
node -v          # 期望 v24.x
nginx -v

# 运行用户
sudo useradd -r -m -d /opt/notizhi -s /usr/sbin/nologin notizhi || true

# 目录
sudo mkdir -p /opt/notizhi/app /var/lib/notizhi/wechat-gate/media /var/backups/notizhi
sudo chown -R notizhi:notizhi /opt/notizhi /var/lib/notizhi /var/backups/notizhi
```

---

## 3. 传代码

在本机执行（把 `你的IP` 换掉）：

```bash
cd "E:/custom_app/notification-analysis(1)"
scp -r daima ubuntu@你的IP:/opt/notizhi/app
```

或在服务器上 `git clone` 你的仓库（需先提交代码）。

服务器上装依赖：

```bash
sudo -u notizhi bash -lc '
cd /opt/notizhi/app
npm ci --omit=dev
'
```

> 服务器只跑网关，不需要 vite / react / playwright。`--omit=dev` 能省一半体积。

---

## 4. 配置

```bash
sudo -u notizhi bash -lc '
cd /opt/notizhi/app
cp .env.wechat.example .env.wechat.local
chmod 600 .env.wechat.local
nano .env.wechat.local
'
```

填这几项（值从微信客服后台取，别贴到聊天里）：

```
WECOM_CORP_ID=ww...
WECOM_SECRET=...
WECOM_TOKEN=...                 # 与后台填的必须完全一致
WECOM_ENCODING_AES_KEY=...      # 43 位
WECOM_OPEN_KFID=wk...
WECHAT_GATE_PUBLIC_URL=http://你的IP:8080/wechat/callback
WECHAT_GATE_TESTER_IDS=         # 先留空，验证通过后填自己
WECHAT_GATE_STORE=/var/lib/notizhi/wechat-gate
WECHAT_GATE_HOST=127.0.0.1      # 走 Nginx，不直连
```

改完确认权限：

```bash
ls -l /opt/notizhi/app/.env.wechat.local   # 必须是 -rw------- notizhi
```

---

## 5. 启动（systemd 托管）

```bash
sudo tee /etc/systemd/system/notizhi-gate.service > /dev/null <<'EOF'
[Unit]
Description=Notizhi WeChat Gate
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=notizhi
WorkingDirectory=/opt/notizhi/app
ExecStart=/usr/bin/node server/wechat-gate.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now notizhi-gate
sudo systemctl status notizhi-gate --no-pager
sudo journalctl -u notizhi-gate -n 30 --no-pager
```

日志应出现：`微信接入网关 r3 :3002 (127.0.0.1)` + `数据目录：/var/lib/notizhi/wechat-gate` + `回调就绪。`

> **单实例铁律**：同一个 `open_kfid` 同时只能有一个网关在跑。本机的网关必须先停掉，否则消息会被两边抢、重复回复。

---

## 6. Nginx 反代

```bash
sudo tee /etc/nginx/sites-available/notizhi > /dev/null <<'EOF'
server {
    listen 8080;
    server_name _;
    client_max_body_size 1m;

    # 微信回调：绝不能加鉴权、跳转、强制 HTTPS
    location = /wechat/callback {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_read_timeout 10s;
    }

    # 健康检查：只给自己的 IP
    location = /health {
        allow 你的本机公网IP;
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:3002;
    }

    location / { return 404; }
}
EOF

sudo ln -sf /etc/nginx/sites-available/notizhi /etc/nginx/sites-enabled/notizhi
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

外网验证（在你本机浏览器或另一台机器）：

```
http://你的IP:8080/wechat/callback        → 应返回 400 missing parameters
http://你的IP:8080/                      → 应返回 404
```

`400` 说明链路通了、验签逻辑在工作。`404` 说明 Nginx 路径没对上。超时说明安全组没放行 8080。

---

## 7. 预检（关键一步）

```bash
sudo -u notizhi bash -lc 'cd /opt/notizhi/app && npm run verify:wechat'
```

它会逐项告诉你哪里不对，且**不打印任何密钥**：

| 输出 | 含义 | 处理 |
|---|---|---|
| `gettoken 被 IP 限制 (60020)` | 服务器出口 IP 不在可信列表 | 后台 → 应用管理 → 微信客服 → 企业可信 IP，填入脚本打印的出口 IP |
| `WECOM_OPEN_KFID 不在可访问账号中` | 客服账号 ID 填错 | 从脚本列出的可访问账号里选正确的 |
| `这是第三方隧道的域名` | 回调 URL 还是 trycloudflare 之类 | 改成 `http://IP:8080/wechat/callback` |
| `五项必要配置不齐` | 有项目没填 | 补 `.env.wechat.local` |
| `预检通过` | 可以回后台点保存了 | 走第 8 步 |

---

## 8. 微信后台配置（只能你本人操作）

1. 打开 <https://kf.weixin.qq.com/> → 扫码登录
2. 开发配置 → 接收消息服务器 → **开始使用/修改**
3. 填：

| 字段 | 值 |
|---|---|
| URL | `http://你的IP:8080/wechat/callback` |
| Token | 与 `WECOM_TOKEN` **完全一致** |
| EncodingAESKey | 与 `WECOM_ENCODING_AES_KEY` **完全一致** |

4. 点保存

**成功标志**：页面提示保存成功（不是「回调域名校验失败」）。

若报 `-50025 回调域名校验失败`：
- 确认 URL 里是**纯 IP**，没有任何域名
- 确认端口是 8080（不是 443、不是域名）
- 仍失败 → 见第 10 节，方案要转认证路线

---

## 9. 验收判据（A0 通过 = 以下全满足）

```bash
# 1) 服务活着
curl http://127.0.0.1:3002/health
# 期望 configured=true

# 2) 后台保存成功（第 8 步页面提示）

# 3) 手机微信找到客服账号 → 发一句「测试1」
#    期望收到：收到 文字「测试1」；当前仅为接入验证，尚未解析通知内容。
```

```bash
# 4) 数据落库
sudo -u notizhi node -e "
const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync('/var/lib/notizhi/wechat-gate/state.db');
console.log(d.prepare('SELECT COUNT(*) c FROM events').get());
console.log(d.prepare('SELECT COUNT(*) c FROM dedup WHERE replied=1').get());
"
# 期望 events ≥ 1、replied ≥ 1
```

四条全中 → A0 通过，可以进 A 阶段（备份、监控）和 B 阶段（接 AI）。

> 注意：此时白名单还是空的，所以**你发消息也不会收到回复**。要收到回复，得先把你的 `sender_id` 填进 `WECHAT_GATE_TESTER_IDS` 并重启。你的 `sender_id` 会出现在 `events` 表的 `sender_id` 列里。

```bash
sudo -u notizhi node -e "
const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync('/var/lib/notizhi/wechat-gate/state.db');
console.log(d.prepare('SELECT DISTINCT sender_id FROM events').all());
"
```

把打印出来的 `sender_id` 填进 `.env.wechat.local` 的 `WECHAT_GATE_TESTER_IDS`，`sudo systemctl restart notizhi-gate`，再发一次，这次应该收到回执。

---

## 10. 失败处置

| 现象 | 概率 | 处置 |
|---|---|---|
| `-50025 回调域名校验失败`，URL 确实是纯 IP | 20-30% | 转认证路线：企业微信认证（300 元/年）+ 备案域名（2-4 周）。**在此之前不要写 B 阶段代码** |
| `60020 not allow to access from your ip` | 30-40% | 配企业可信 IP；若提示「第三方服务商 IP」→ 换云厂商/地域（部分 IDC 段被微信标记） |
| 手机发消息，服务端没收到 | — | 查 `journalctl -u notizhi-gate -f`；确认后台 URL 保存成功；确认 `WECOM_OPEN_KFID` 匹配 |
| 收到消息但没回复 | — | 白名单为空，按第 9 节末尾填 `sender_id` |
| 80 端口外网打不开 | 70% | 未备案域名/IP 的 80 口常被限制。**只影响公众号**，微信客服走 8080 不受影响 |
| 重启后消息不处理 | — | 看 `pending_tasks` 里是否有 `failed`，`last_error` 会说明原因 |

---

## 11. 日常运维

```bash
# 看日志
sudo journalctl -u notizhi-gate -f

# 重启
sudo systemctl restart notizhi-gate

# 更新代码（本机 push 后）
sudo -u notizhi bash -lc 'cd /opt/notizhi/app && git pull && npm ci --omit=dev'
sudo systemctl restart notizhi-gate
```

备份（先手动跑一次，确认能用）：

```bash
sudo -u notizhi node -e "
const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync('/var/lib/notizhi/wechat-gate/state.db');
d.exec(\"VACUUM INTO '/var/backups/notizhi/state-feima.db'\");
d.close();
"
ls -lh /var/backups/notizhi/
```

能打开备份库并读出 `events` 才算备份有效。

---

## 12. 出问题先看哪

| 顺序 | 命令 | 看什么 |
|---|---|---|
| 1 | `systemctl status notizhi-gate` | 进程活着吗 |
| 2 | `journalctl -u notizhi-gate -n 50` | 启动日志、报错 |
| 3 | `npm run verify:wechat` | 配置与出网 |
| 4 | `curl -v http://你的IP:8080/wechat/callback` | 外网链路 |
| 5 | `state.db` 的 `pending_tasks.last_error` | 处理失败原因 |
