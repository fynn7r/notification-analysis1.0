#!/usr/bin/env node
/**
 * 边界样本回放。
 *
 * 默认离线：不请求任何模型，把 expected.json 里记录的「模型输出」喂进真实解析管线，
 * 断言服务端对这些输出的处置是否符合契约。测的是**校验逻辑**，不是模型水平，
 * 因此结果稳定、不花钱、可进 CI。
 *
 * 加 --live 则真调模型：用来抽检模型本身是否退步。此模式下断言失败只警告不中断，
 * 因为同一句话可以有多种合法表达，措辞差异不该让发布被卡住。
 *
 *   node scripts/replay-samples.mjs            离线
 *   node scripts/replay-samples.mjs --live     在线抽检
 *   node scripts/replay-samples.mjs --only=G3  只跑一条
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = resolve(ROOT, 'docs/examples');
const args = process.argv.slice(2);
const live = args.includes('--live');
const only = args.find((a) => a.startsWith('--only='))?.slice(7);

const { parseNotification, configuration, ApiError } = await import('../server/parse-service.mjs');

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

async function loadSamples() {
  const entries = await readdir(EXAMPLES, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && /^G\d+-/.test(e.name))
    .map((e) => e.name)
    .filter((name) => !only || name.startsWith(`${only}-`))
    .sort((a, b) => Number(a.slice(1).split('-')[0]) - Number(b.slice(1).split('-')[0]));
  const samples = [];
  for (const dir of dirs) {
    const [text, expectedRaw] = await Promise.all([
      readFile(join(EXAMPLES, dir, 'input.md'), 'utf8'),
      readFile(join(EXAMPLES, dir, 'expected.json'), 'utf8'),
    ]);
    samples.push({ dir, text: text.trim(), expected: JSON.parse(expectedRaw) });
  }
  return samples;
}

/** 用固定的模型输出伪造一次上游响应，走的是真实的 requestModelJson → 契约校验 → 字段处理。 */
function fakeFetch(modelOutput) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(modelOutput) } }],
      usage: { completion_tokens: 0 },
    }),
  });
}

function describeMismatch(field, actual, expected) {
  return `${field} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`;
}

/** 逐条比对断言；返回失败描述数组。 */
function evaluate(result, expected) {
  const failures = [];
  const { assert } = expected;

  if (assert.error) {
    if (!result.error) {
      failures.push(`应当失败（${assert.error.status} ${assert.error.code}），但成功返回了结果`);
      return failures;
    }
    if (result.error.status !== assert.error.status) {
      failures.push(describeMismatch('status', result.error.status, assert.error.status));
    }
    if (result.error.code !== assert.error.code) {
      failures.push(describeMismatch('code', result.error.code, assert.error.code));
    }
    if (assert.error.messageContains && !String(result.error.message).includes(assert.error.messageContains)) {
      failures.push(`错误信息未包含「${assert.error.messageContains}」，实际：${result.error.message}`);
    }
    return failures;
  }

  if (result.error) {
    failures.push(`不应失败，但抛出了 ${result.error.status} ${result.error.code}：${result.error.message}`);
    return failures;
  }

  const payload = result.value;
  for (const key of ['deadline', 'eventStartTime', 'actionTitle', 'type']) {
    if (!(key in assert)) continue;
    const actual = key === 'deadline'
      ? payload.notification.registrationDeadline
      : key === 'eventStartTime'
        ? payload.notification.eventStartTime
        : key === 'actionTitle'
          ? payload.action.title
          : payload.notification.type;
    if (actual !== assert[key]) failures.push(describeMismatch(key, actual, assert[key]));
  }

  const warnings = payload.warnings ?? [];
  for (const fragment of assert.warningsContain ?? []) {
    if (!warnings.some((w) => w.includes(fragment))) {
      failures.push(`warnings 未包含「${fragment}」，实际：${JSON.stringify(warnings)}`);
    }
  }
  if (typeof assert.warningsMin === 'number' && warnings.length < assert.warningsMin) {
    failures.push(`warnings 至少应有 ${assert.warningsMin} 条，实际 ${warnings.length} 条`);
  }
  return failures;
}

async function runOne(sample, config) {
  const { text, expected } = sample;
  const input = {
    text,
    referenceDate: expected.referenceDate,
    timezone: expected.timezone || 'Asia/Shanghai',
  };
  const fetchImpl = live ? fetch : fakeFetch(expected.modelOutput);
  try {
    const value = await parseNotification(input, config, fetchImpl);
    return { value };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: { status: error.status, code: error.code, message: error.message } };
    }
    return { error: { status: 0, code: 'UNEXPECTED', message: error.message } };
  }
}

const samples = await loadSamples();
if (!samples.length) {
  console.error('没有找到样本目录（docs/examples/G*/）');
  process.exit(1);
}

const config = live
  ? configuration()
  : {
    apiKey: 'offline-replay',
    baseUrl: 'https://offline.invalid',
    model: 'offline-replay',
    timeoutMs: 5000,
    maxTokens: 4096,
  };

if (live && !config.apiKey.trim()) {
  console.error('--live 需要先配置 AI_API_KEY（.env.local），已中止。');
  process.exit(1);
}

console.log(live ? '\n在线抽检（真调模型，断言失败只警告）\n' : '\n离线回放（不请求模型）\n');

let passed = 0;
let failed = 0;
let warned = 0;

for (const sample of samples) {
  const started = Date.now();
  const result = await runOne(sample, config);
  const failures = evaluate(result, sample.expected);
  const elapsed = Date.now() - started;
  const label = `${sample.dir}`.padEnd(28);

  if (!failures.length) {
    passed += 1;
    console.log(`${GREEN}✓${RESET} ${label} ${DIM}${elapsed}ms${RESET}`);
    continue;
  }

  if (live) {
    warned += 1;
    console.log(`${RED}!${RESET} ${label} ${DIM}${elapsed}ms（仅警告）${RESET}`);
  } else {
    failed += 1;
    console.log(`${RED}✗${RESET} ${label}`);
  }
  for (const failure of failures) console.log(`    ${failure}`);
}

console.log(`\n共 ${samples.length} 条 · 通过 ${passed}${failed ? ` · 失败 ${failed}` : ''}${warned ? ` · 警告 ${warned}` : ''}\n`);
process.exit(failed ? 1 : 0);
