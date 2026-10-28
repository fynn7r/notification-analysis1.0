/**
 * 远程入口（本机 3003）。
 *
 * 只提供两样东西：构建后的前端，和一组白名单 API。
 * 所有分析类接口都要先有会话；不暴露 /api/ai/*、环境文件、数据库或任何本机路径。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, configuration, parseNotification } from './parse-service.mjs';
import { interpretNotification } from './interpret-service.mjs';
import { generateNotification } from './generate-service.mjs';
import { createEnvSettingsStore } from './ai-settings-service.mjs';
import { extractRuleDocument } from './rule-document-service.mjs';
import { extractWechatArticle } from './article-extract.mjs';
import { visionConfiguration } from './vision-service.mjs';
import { MAX_DOCUMENT_BYTES } from '../shared/rule-document-contract.ts';
import { createKnowledgeRouter, getSessionUser } from './knowledge/http.mjs';
import { retrieveContext } from './knowledge/search.mjs';
import { openKnowledgeDb } from './knowledge/db.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const PAID_ENDPOINTS = new Set(['/api/parse', '/api/interpret', '/api/generate']);

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容过大。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {{staticDir: string, settingsStore: any, knowledgeStore: any, fetchImpl?: typeof fetch}} options
 */
export function createRemoteServer({ staticDir, settingsStore, knowledgeStore, fetchImpl = fetch }) {
  const root = resolve(staticDir);
  const knowledgeRouter = createKnowledgeRouter({ store: knowledgeStore, secureCookies: false });

  async function serveStatic(request, response, pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return false; }
    const candidate = resolve(root, `.${decoded}`);
    if (candidate !== root && !candidate.startsWith(root + sep)) return false;
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
    const ext = extname(candidate).toLowerCase();
    if (!MIME[ext]) return false;
    response.statusCode = 200;
    response.setHeader('Content-Type', MIME[ext]);
    response.setHeader('Cache-Control', ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable');
    await new Promise((resolvePromise, reject) => {
      const stream = createReadStream(candidate);
      stream.on('error', reject);
      response.on('close', resolvePromise);
      stream.pipe(response);
    });
    return true;
  }

  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/knowledge/')) {
        await knowledgeRouter.handle(request, response);
        return;
      }

      // 明确不提供的接口：先拦住，避免落到静态兜底。
      if (pathname.startsWith('/api/ai/') || pathname.startsWith('/api/debug') || pathname === '/api/healthz') {
        sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
        return;
      }

      if (pathname === '/api/article' || PAID_ENDPOINTS.has(pathname) || pathname === '/api/rules/import') {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持。' } });
          return;
        }
        const user = getSessionUser(knowledgeStore.db, request);
        if (!user) {
          sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: '请先登录后再使用分析功能。' } });
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: { code: 'CROSS_ORIGIN', message: '不接受跨站请求。' } });
          return;
        }

        const config = settingsStore ? settingsStore.getConfig() : configuration();
        if (pathname === '/api/rules/import') {
          if (!request.headers['content-type']?.startsWith('multipart/form-data')) {
            throw new ApiError(415, 'INVALID_CONTENT_TYPE', '请使用文件上传方式提交文档。');
          }
          const body = await readBody(request, MAX_DOCUMENT_BYTES + 64 * 1024);
          let form;
          try {
            form = await new Request('http://localhost/api/rules/import', {
              method: 'POST', headers: { 'Content-Type': request.headers['content-type'] }, body,
            }).formData();
          } catch { throw new ApiError(400, 'INVALID_DOCUMENT_UPLOAD', '文件上传内容无效，请重新选择文件。'); }
          const files = form.getAll('file');
          if (files.length !== 1 || !(files[0] instanceof File)) {
            throw new ApiError(400, 'INVALID_DOCUMENT_UPLOAD', '请每次上传一个文件。');
          }
          const file = files[0];
          sendJson(response, 200, await extractRuleDocument(file.name, Buffer.from(await file.arrayBuffer())));
          return;
        }

        const body = await readBody(request, 256 * 1024);
        let input;
        try { input = JSON.parse(body.toString('utf8')); }
        catch { throw new ApiError(400, 'INVALID_JSON', '提交的 JSON 内容无效。'); }

        if (pathname === '/api/article') {
          const visionConfig = visionConfiguration({
            ...process.env,
            AI_API_KEY: config.apiKey,
            AI_BASE_URL: config.baseUrl,
          });
          sendJson(response, 200, await extractWechatArticle(input?.url, { fetchImpl, visionConfig }));
          return;
        }

        let retrieval = null;
        if (pathname !== '/api/generate') {
          const selected = Array.isArray(input.knowledgeEntryIds) ? input.knowledgeEntryIds.map(String).slice(0, 50) : null;
          retrieval = retrieveContext(knowledgeStore, {
            userId: user.id,
            query: typeof input.text === 'string' ? input.text : '',
            selectedEntryIds: selected,
          });
        }
        const service = pathname === '/api/generate' ? generateNotification
          : pathname === '/api/interpret' ? interpretNotification : parseNotification;
        const result = pathname === '/api/generate'
          ? await service(input, config, fetchImpl)
          : await service(input, config, fetchImpl, retrieval);
        sendJson(response, 200, result);
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持。' } });
        return;
      }

      if (await serveStatic(request, response, pathname)) return;
      // 前端路由回落到入口页；不存在的资源仍给 404，避免把 404 伪装成 200。
      if (!extname(pathname) && (await serveStatic(request, response, '/standalone.html'))) return;
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '页面不存在。' } });
    } catch (error) {
      const known = error instanceof ApiError;
      if (!response.headersSent) {
        sendJson(response, known ? error.status : 500, {
          error: {
            code: known ? error.code : 'INTERNAL_ERROR',
            message: known ? error.message : '服务暂时不可用，请重试。',
          },
        });
      } else {
        response.end();
      }
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  try { process.loadEnvFile(resolve(root, '.env.local')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staticDir = resolve(root, 'dist-standalone');
  if (!existsSync(resolve(staticDir, 'standalone.html'))) {
    console.error('未找到 dist-standalone/standalone.html，请先运行 npm run build:standalone。');
    process.exit(1);
  }
  const settingsStore = createEnvSettingsStore(resolve(root, '.env.local'));
  const knowledgeStore = openKnowledgeDb({ dir: process.env.KNOWLEDGE_STORE || resolve(root, '.local/knowledge') });
  const port = Number(process.env.REMOTE_PORT) || 3003;
  createRemoteServer({ staticDir, settingsStore, knowledgeStore }).listen(port, '127.0.0.1', () => {
    console.log(`远程入口：http://127.0.0.1:${port}`);
    console.log('通过反向代理或隧道对外时必须是 HTTPS；未登录访问分析接口会被拒绝。');
  });
}
