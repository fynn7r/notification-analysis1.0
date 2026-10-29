import { readFileSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { aiSettingsInputSchema, aiSettingsSchema, aiModelsSchema, aiBalanceSchema } from '../shared/ai-settings-contract.ts';
import { ApiError, configuration } from './parse-service.mjs';

export function publicAiSettings(config) {
  const official = new URL(config.baseUrl).hostname === 'api.deepseek.com';
  return aiSettingsSchema.parse({
    baseUrl: config.baseUrl, model: config.model,
    interpretationModel: config.interpretationModel || '', generateModel: config.generateModel || '',
    consoleUrl: config.consoleUrl || (official ? 'https://platform.deepseek.com' : ''),
    configured: !!config.apiKey.trim(), balanceSupported: official, maxTokens: config.maxTokens,
  });
}

// 只更新模型配置；保留端口、超时及其他环境变量。每次请求读取，保存后无需重启。
export function createEnvSettingsStore(path, env = process.env) {
  const read = () => {
    try { return readFileSync(path, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return '';
      throw new ApiError(500, 'AI_SETTINGS_READ_FAILED', '无法读取本地模型配置，请检查 .env.local 的访问权限。');
    }
  };
  const getConfig = () => configuration({ ...env, ...parseEnv(read()) });
  return {
    getConfig,
    async save(input) {
      const checked = aiSettingsInputSchema.safeParse(input);
      if (!checked.success) throw new ApiError(400, 'INVALID_SETTINGS', checked.error.issues[0].message);
      const data = checked.data;
      const previous = getConfig();
      if (new URL(data.baseUrl).origin !== new URL(previous.baseUrl).origin && previous.apiKey.trim() && !data.apiKey) {
        throw new ApiError(400, 'AI_NEW_KEY_REQUIRED', '更换服务商时请填写该服务商的密钥。更换同一服务商的模型可留空保留现有密钥。');
      }
      const values = {
        AI_BASE_URL: data.baseUrl.replace(/\/+$/, ''), AI_MODEL: data.model,
        AI_INTERPRET_MODEL: data.interpretationModel, AI_GENERATE_MODEL: data.generateModel,
        AI_CONSOLE_URL: data.consoleUrl, AI_MAX_TOKENS: String(data.maxTokens),
        ...(data.apiKey ? { AI_API_KEY: data.apiKey } : {}),
      };
      let content = read();
      for (const [name, value] of Object.entries(values)) {
        const line = `${name}=${JSON.stringify(value)}`;
        const pattern = new RegExp(`^(?:export\\s+)?${name}\\s*=.*$`, 'gm');
        content = pattern.test(content) ? content.replace(pattern, () => line) : `${content}${content.endsWith('\n') || !content ? '' : '\n'}${line}\n`;
      }
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content, { mode: 0o600 });
        await rename(temporary, path);
      } catch {
        await unlink(temporary).catch(() => {});
        throw new ApiError(500, 'AI_SETTINGS_SAVE_FAILED', '模型配置未保存，请检查 .env.local 的访问权限；原配置仍有效。');
      }
      return publicAiSettings(getConfig());
    },
  };
}

export function requireLocalSettingsRequest(request) {
  const local = (hostname) => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
  try {
    const host = new URL(`http://${request.headers.host}`);
    const origin = request.headers.origin ? new URL(request.headers.origin) : null;
    if (!local(host.hostname) || (origin && !local(origin.hostname)) || request.headers['sec-fetch-site'] === 'cross-site') throw new Error();
  } catch {
    throw new ApiError(403, 'LOCAL_SETTINGS_ONLY', '模型配置和账户查询仅允许从本机页面访问。');
  }
}

async function queryAccount(url, config, fetchImpl) {
  if (!config.apiKey.trim()) throw new ApiError(503, 'AI_NOT_CONFIGURED', '请先保存模型密钥，再查询模型列表或余额。');
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30000)), redirect: 'error',
    });
    if (!response.ok) {
      const code = [401, 403].includes(response.status) ? 'AI_AUTH_FAILED' : response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_ACCOUNT_QUERY_FAILED';
      throw new ApiError(502, code, code === 'AI_AUTH_FAILED' ? '密钥无效或无查询权限，请检查模型配置。' : '服务商账户查询失败，请稍后手动重试或打开控制台查看。');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'AI_ACCOUNT_QUERY_FAILED', '无法连接服务商查询接口或返回格式无效，请检查地址，或打开控制台查看。');
  }
}

export async function listAiModels(config, fetchImpl = fetch) {
  const payload = await queryAccount(`${config.baseUrl}/models`, config, fetchImpl);
  const result = aiModelsSchema.safeParse({ models: Array.isArray(payload?.data) ? [...new Set(payload.data.map((model) => model?.id))] : null });
  if (!result.success) throw new ApiError(502, 'INVALID_ACCOUNT_OUTPUT', '服务商未返回有效的模型列表，请按其文档手动填写模型 ID。');
  return result.data;
}

export async function getAiBalance(config, fetchImpl = fetch) {
  if (new URL(config.baseUrl).hostname !== 'api.deepseek.com') {
    throw new ApiError(400, 'AI_BALANCE_UNSUPPORTED', '该服务商暂未接入余额查询，请打开服务商控制台查看额度。');
  }
  const payload = await queryAccount('https://api.deepseek.com/user/balance', config, fetchImpl);
  const result = aiBalanceSchema.safeParse({
    available: payload?.is_available,
    balances: Array.isArray(payload?.balance_infos) ? payload.balance_infos.map((item) => ({
      currency: item.currency, total: item.total_balance, granted: item.granted_balance, toppedUp: item.topped_up_balance,
    })) : null,
    checkedAt: new Date().toISOString(),
  });
  if (!result.success) throw new ApiError(502, 'INVALID_ACCOUNT_OUTPUT', '服务商余额数据格式无效，请打开控制台核对。');
  return result.data;
}
