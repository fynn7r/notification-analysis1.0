/**
 * 为单端口运行提供前端静态文件托管。
 *
 * 只做三件事：命中真实文件就返回、HTML 请求回退到应用入口、其余交给 404。
 * 前端用 BrowserRouter，所以 /rules 这类深链接必须回退到入口页，否则刷新即白屏。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function contentTypeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function statFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} rootDir 构建产物目录（dist-standalone）
 * @param {{entry?: string}} options entry 为应用入口文件名，默认 standalone.html
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<boolean>}
 */
export function createStaticHandler(rootDir, options = {}) {
  const root = resolve(rootDir);
  const entry = options.entry || 'standalone.html';
  const entryPath = join(root, entry);

  const sendFile = async (request, response, filePath, info) => {
    const isHashedAsset = /[\\/]assets[\\/]/.test(filePath) && /-[A-Za-z0-9_]{8,}\./.test(filePath);
    response.statusCode = 200;
    response.setHeader('Content-Type', contentTypeFor(filePath));
    response.setHeader('Content-Length', info.size);
    // 带内容指纹的产物可长缓存；入口 HTML 必须每次校验，否则升级后用户会加载到旧资源。
    response.setHeader('Cache-Control', isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (request.method === 'HEAD') {
      response.end();
      return true;
    }
    await new Promise((done) => {
      const stream = createReadStream(filePath);
      stream.on('error', () => { response.destroy(); done(); });
      stream.on('end', done);
      stream.pipe(response);
    });
    return true;
  };

  return async function serve(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      return false;
    }
    if (pathname.startsWith('/api/')) return false;

    // 防目录穿越：规范化后必须仍在 root 之内。
    const target = resolve(join(root, pathname));
    if (target !== root && !target.startsWith(root + sep)) return false;

    if (pathname !== '/') {
      const info = await statFile(target);
      if (info) return sendFile(request, response, target, info);
    }

    // 只对页面请求回退入口；缺失的 .js/.css 必须返回真实 404，避免浏览器拿到 HTML 当脚本。
    const accept = String(request.headers.accept || '');
    const looksLikePage = accept.includes('text/html') || pathname === '/' || !extname(pathname);
    if (!looksLikePage) return false;

    const entryInfo = await statFile(entryPath);
    if (!entryInfo) return false;
    return sendFile(request, response, entryPath, entryInfo);
  };
}

/** 判断构建产物是否可用，供启动脚本给出准确提示。 */
export async function assertBuildReady(rootDir, entry = 'standalone.html') {
  const normalized = normalize(rootDir);
  const info = await statFile(join(normalized, entry));
  return Boolean(info && info.size > 0);
}
