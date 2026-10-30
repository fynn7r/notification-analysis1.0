import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ApiError, configuration, parseNotification } from './parse-service.mjs';
import { generateNotification } from './generate-service.mjs';
import { interpretNotification } from './interpret-service.mjs';
import { createEnvSettingsStore, publicAiSettings, requireLocalSettingsRequest, listAiModels, getAiBalance } from './ai-settings-service.mjs';
import { extractRuleDocument } from './rule-document-service.mjs';
import { extractWechatArticle } from './article-extract.mjs';
import { visionConfiguration } from './vision-service.mjs';
import { createStaticHandler } from './static-server.mjs';
import { MAX_DOCUMENT_BYTES } from '../shared/rule-document-contract.ts';
import { createKnowledgeRouter, getSessionUser } from './knowledge/http.mjs';
import { retrieveContext } from './knowledge/search.mjs';
import { openKnowledgeDb } from './knowledge/db.mjs';

export function createApiServer(config = configuration(), fetchImpl = fetch, settingsStore = null, knowledgeStore = null, staticDir = null) {
  let realParseVerified = false;
  const knowledgeRouter = knowledgeStore ? createKnowledgeRouter({ store: knowledgeStore }) : null;
  // 传入构建目录时，同一端口同时提供前端与 API，避免普通用户维护两个进程。
  const staticHandler = staticDir ? createStaticHandler(staticDir) : null;
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const send = (status, value) => {
      response.statusCode = status;
      response.end(JSON.stringify(value));
    };
    const pathname = new URL(request.url, 'http://localhost').pathname;
    try {
      if (staticHandler && await staticHandler(request, response)) return;
      const activeConfig = settingsStore ? settingsStore.getConfig() : config;
      if (knowledgeRouter && (
        pathname.startsWith('/api/auth/')
        || pathname.startsWith('/api/knowledge/')
        || pathname === '/api/reminders'
        || pathname.startsWith('/api/reminders/')
      )) {
        await knowledgeRouter.handle(request, response);
        return;
      }
      if (request.method === 'GET' && pathname === '/api/health') {
        send(200, { configured: !!activeConfig.apiKey.trim(), realParseVerified });
        return;
      }
      if (pathname.startsWith('/api/ai/')) requireLocalSettingsRequest(request);
      if (request.method === 'GET' && pathname === '/api/ai/settings') {
        send(200, publicAiSettings(activeConfig));
        return;
      }
      if (request.method === 'POST' && ['/api/ai/models', '/api/ai/balance'].includes(pathname)) {
        send(200, await (pathname === '/api/ai/models' ? listAiModels : getAiBalance)(activeConfig, fetchImpl));
        return;
      }
      if (!['/api/parse', '/api/generate', '/api/interpret', '/api/rules/import', '/api/article', '/api/ai/settings'].includes(pathname) || request.method !== 'POST') {
        send(404, { error: { code: 'NOT_FOUND', message: '接口不存在' } });
        return;
      }
      const importingDocument = pathname === '/api/rules/import';
      if (!request.headers['content-type']?.startsWith(importingDocument ? 'multipart/form-data' : 'application/json')) {
        throw new ApiError(415, 'INVALID_CONTENT_TYPE', importingDocument ? '请使用文件上传方式提交规则文档。' : '请使用 JSON 提交通知。');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > (importingDocument ? MAX_DOCUMENT_BYTES + 64 * 1024 : 256 * 1024)) throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容过大。');
        chunks.push(chunk);
      }
      if (importingDocument) {
        let form;
        try {
          form = await new Request('http://localhost/api/rules/import', {
            method: 'POST', headers: { 'Content-Type': request.headers['content-type'] },
            body: Buffer.concat(chunks),
          }).formData();
        } catch { throw new ApiError(400, 'INVALID_DOCUMENT_UPLOAD', '文件上传内容无效，请重新选择文件。'); }
        const files = form.getAll('file');
        const file = files[0];
        if (files.length !== 1 || !(file instanceof File)) throw new ApiError(400, 'INVALID_DOCUMENT_UPLOAD', '请每次上传一个规则文件。');
        send(200, await extractRuleDocument(file.name, Buffer.from(await file.arrayBuffer())));
        return;
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new ApiError(400, 'INVALID_JSON', '提交的 JSON 内容无效。'); }
      if (pathname === '/api/ai/settings') {
        if (!settingsStore) throw new ApiError(503, 'AI_SETTINGS_UNAVAILABLE', '当前服务不支持保存配置，请使用本地独立版启动命令。');
        const settings = await settingsStore.save(input);
        realParseVerified = false;
        send(200, settings);
        return;
      }
      if (pathname === '/api/article') {
        // 密钥与地址跟随当前生效的模型配置，视觉模型名单独由 AI_VISION_MODEL 指定。
        const visionConfig = visionConfiguration({
          ...process.env,
          AI_API_KEY: activeConfig.apiKey,
          AI_BASE_URL: activeConfig.baseUrl,
        });
        send(200, await extractWechatArticle(input?.url, { fetchImpl, visionConfig }));
        return;
      }
      const service = pathname === '/api/generate' ? generateNotification : pathname === '/api/interpret' ? interpretNotification : parseNotification;
      // 登录用户的分析必须基于服务端授权检索的知识；匿名用法完全不碰账号数据。
      let retrieval = null;
      if (knowledgeStore && pathname !== '/api/generate') {
        const user = getSessionUser(knowledgeStore.db, request);
        if (user) {
          const selected = Array.isArray(input.knowledgeEntryIds) ? input.knowledgeEntryIds.map(String).slice(0, 50) : null;
          retrieval = retrieveContext(knowledgeStore, {
            userId: user.id,
            query: typeof input.text === 'string' ? input.text : '',
            selectedEntryIds: selected,
          });
        }
      }
      const result = pathname === '/api/generate'
        ? await service(input, activeConfig, fetchImpl)
        : await service(input, activeConfig, fetchImpl, retrieval);
      if (pathname === '/api/parse') realParseVerified = true;
      send(200, result);
    } catch (error) {
      const known = error instanceof ApiError;
      send(known ? error.status : 500, { error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : '本地服务暂时不可用，请重试。',
      } });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.API_PORT) || 3001;
  const root = fileURLToPath(new URL('..', import.meta.url));
  const settingsStore = createEnvSettingsStore(fileURLToPath(new URL('../.env.local', import.meta.url)));
  const config = settingsStore.getConfig();
  const knowledgeStore = openKnowledgeDb({ dir: process.env.KNOWLEDGE_STORE || resolve(root, '.local/knowledge') });
  createApiServer(config, fetch, settingsStore, knowledgeStore).listen(port, '127.0.0.1', () => {
    console.log(`解析服务：http://127.0.0.1:${port}`);
    console.log(config.apiKey.trim() ? '模型密钥已配置；真实解析尚未验证，首次成功调用后更新状态。' : '真实解析尚未验证：请在 .env.local 配置 AI_API_KEY。');
    console.log(`知识库：${knowledgeStore.dir}${knowledgeStore.ftsEnabled ? '' : '（全文索引不可用，已降级为文本匹配）'}`);
  });
}
