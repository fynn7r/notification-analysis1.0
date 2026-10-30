# 部署说明

默认用法是「自己电脑上双击启动」，不需要这份文档。**只有当你打算把它放到一台服务器上、让多人访问时才需要读下去。**

---

## 1. 为什么需要反向代理

项目本身**只监听 `127.0.0.1` 的 HTTP**，不处理 TLS。原因有两条：

1. 单机自用时，本机回环就是信任边界，加证书只是增加启动负担；
2. 证书续期、HSTS、HTTP/2 这些事，nginx / Caddy 做得比一个业务进程好得多，也更不容易配错。

所以部署形态固定为：

```
浏览器 ──HTTPS──> nginx / Caddy ──HTTP──> 127.0.0.1:8001 (node)
```

## 2. 一条必须透传的请求头

`x-forwarded-proto: https`

服务端用它决定要不要给 Cookie 加 `Secure` 标志：

```js
// server/knowledge/http.mjs:75-78
const secureFor = (request) => secureCookies
  || Boolean(request.socket?.encrypted)
  || request.headers['x-forwarded-proto'] === 'https';
```

漏了这个头，Node 只看到一条普通 HTTP 连接，于是 Cookie 不加 `Secure`——浏览器在 HTTPS 页面里仍会接受它，看起来一切正常，**但一旦被降级到 HTTP，会话就会以明文传输**。这是最容易漏、也最难在测试中发现的一项。

## 3. nginx 示例

```nginx
server {
  listen 443 ssl http2;
  server_name notice.example.com;

  ssl_certificate     /etc/letsencrypt/live/notice.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/notice.example.com/privkey.pem;

  # 文档上传上限要比服务端的 MAX_DOCUMENT_BYTES 稍大，否则大文件在反代就被拒
  client_max_body_size 32m;

  location / {
    proxy_pass http://127.0.0.1:8001;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;   # ← 关键，别漏
    proxy_set_header X-Forwarded-Host  $host;

    # 深度解读可能跑 60 秒以上，服务端超时是 120 秒，这里要更宽
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
  }
}

server {
  listen 80;
  server_name notice.example.com;
  return 301 https://$host$request_uri;
}
```

Caddy 更简单，默认就会透传 `X-Forwarded-Proto`：

```
notice.example.com {
  reverse_proxy 127.0.0.1:8001
}
```

## 4. 环境变量

放在项目根目录的 `.env.local`（已被 `.gitignore` 排除）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8001` | 监听端口 |
| `AI_BASE_URL` | — | 模型网关地址，如 `https://api.deepseek.com` |
| `AI_API_KEY` | — | 网关密钥 |
| `AI_MODEL` | — | 模型名 |
| `AI_MAX_TOKENS` | 官方 8192 / 其他 16384 | 单次输出上限，思考型模型请勿设为 2048 级别 |
| `AI_TIMEOUT_MS` | `120000` | 服务端等待模型的时间 |
| `KNOWLEDGE_STORE` | `.local/knowledge` | **数据库目录，部署时必须指向持久化磁盘** |

`KNOWLEDGE_STORE` 是最容易出事的一个：放在容器临时层或 `/tmp`，重启后账号、知识库、邀请码全没了。

## 5. 数据与备份

```
.local/knowledge/knowledge.db      # 账号、会话、邀请码、知识库（SQLite）
.local/knowledge/knowledge.db-wal  # 预写日志，运行时存在
.env.local                         # 密钥，单独保管
```

备份用 SQLite 自己的命令，**不要直接拷 `.db` 文件**（WAL 未合并时拷出来可能是不一致的快照）：

```bash
sqlite3 .local/knowledge/knowledge.db ".backup '/backup/knowledge-$(date +%F).db'"
```

注意：**待办与个人设置目前存在浏览器 localStorage 里**，不在这个数据库内，换浏览器或清缓存会丢。把它们迁进数据库是当前正在做的工作（见 `CHANGELOG.md` 的 Unreleased）。

## 6. 部署检查清单

- [ ] Node 版本 ≥ 22.18（服务端直接导入 `.ts` 契约文件，依赖类型剥离）
- [ ] 反代透传 `X-Forwarded-Proto`
- [ ] `proxy_read_timeout` ≥ 180 秒
- [ ] `client_max_body_size` ≥ 32 MB
- [ ] `KNOWLEDGE_STORE` 指向持久化磁盘，且在备份范围内
- [ ] 首次启动打印的初始管理员密码已修改
- [ ] 已配置 `.local/` 的定时备份
- [ ] 若为多人使用，`/api/ai/*` 已额外加一层身份校验（它只校验来源为本地，不校验登录态）
