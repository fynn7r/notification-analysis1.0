import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticHandler, assertBuildReady } from './static-server.mjs';

/** 构造一个最小可用产物目录，返回其路径。 */
function makeDist() {
  const root = mkdtempSync(join(tmpdir(), 'notizhi-dist-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'standalone.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(root, 'assets', 'standalone-AbCdEf123456.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'style.css'), 'body{}');
  writeFileSync(join(root, 'favicon.svg'), '<svg/>');
  return root;
}

function hreq(server, method, path, headers = {}) {
  const address = server.address();
  return new Promise((done, reject) => {
    const request = fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers })
      .then(async (response) => done({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      }))
      .catch(reject);
    return request;
  });
}

async function withServer(distDir, run) {
  const handler = createStaticHandler(distDir);
  const server = createServer(async (request, response) => {
    const handled = await handler(request, response);
    if (!handled) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    await run(server);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

test('根路径返回应用入口', async () => {
  const dist = makeDist();
  try {
    await withServer(dist, async (server) => {
      const res = await hreq(server, 'GET', '/', { Accept: 'text/html' });
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /text\/html/);
      assert.match(res.body, /<title>app<\/title>/);
    });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('深链接回退到入口页，避免刷新白屏', async () => {
  const dist = makeDist();
  try {
    await withServer(dist, async (server) => {
      for (const path of ['/rules', '/history', '/profile']) {
        const res = await hreq(server, 'GET', path, { Accept: 'text/html' });
        assert.equal(res.status, 200, `${path} 应回退到入口`);
        assert.match(res.body, /<title>app<\/title>/);
      }
    });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('真实静态文件按扩展名给出类型', async () => {
  const dist = makeDist();
  try {
    await withServer(dist, async (server) => {
      const js = await hreq(server, 'GET', '/assets/standalone-AbCdEf123456.js');
      assert.equal(js.status, 200);
      assert.match(js.headers['content-type'], /javascript/);
      const css = await hreq(server, 'GET', '/assets/style.css');
      assert.match(css.headers['content-type'], /text\/css/);
      const svg = await hreq(server, 'GET', '/favicon.svg');
      assert.match(svg.headers['content-type'], /image\/svg\+xml/);
    });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('带内容指纹的资源长缓存，入口页不缓存', async () => {
  const dist = makeDist();
  try {
    await withServer(dist, async (server) => {
      const hashed = await hreq(server, 'GET', '/assets/standalone-AbCdEf123456.js');
      assert.match(hashed.headers['cache-control'], /immutable/);
      const html = await hreq(server, 'GET', '/', { Accept: 'text/html' });
      assert.match(html.headers['cache-control'], /no-cache/);
    });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('缺失的脚本返回 404，不把 HTML 当脚本发出', async () => {
  const dist = makeDist();
  try {
    await withServer(dist, async (server) => {
      const res = await hreq(server, 'GET', '/assets/missing-XyZ12345678.js');
      assert.equal(res.status, 404);
      assert.doesNotMatch(res.body, /<title>app<\/title>/);
    });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('拒绝目录穿越', async () => {
  const dist = makeDist();
  try {
    await withServer(dist, async (server) => {
      const res = await hreq(server, 'GET', '/../package.json');
      assert.equal(res.status, 404, '不能读到产物目录之外的文件');
      assert.doesNotMatch(res.body, /"name"/);
    });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('API 路径不由静态托管接管', async () => {
  const dist = makeDist();
  try {
    await withServer(dist, async (server) => {
      const res = await hreq(server, 'GET', '/api/health', { Accept: 'text/html' });
      assert.equal(res.status, 404);
      assert.match(res.headers['content-type'], /json/);
    });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('HEAD 请求不返回正文', async () => {
  const dist = makeDist();
  try {
    await withServer(dist, async (server) => {
      const res = await hreq(server, 'HEAD', '/', { Accept: 'text/html' });
      assert.equal(res.status, 200);
      assert.equal(res.body, '');
    });
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('构建产物缺失时能被启动脚本识别', async () => {
  const dist = makeDist();
  try {
    assert.equal(await assertBuildReady(dist), true);
    assert.equal(await assertBuildReady(join(dist, 'nope')), false);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});
