import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseResponseSchema } from '../shared/parse-contract.ts';
import { signupRequest, competitionRequest } from '../server/fixtures.mjs';
import { toDateTimeInput } from '../shared/date-time.ts';

try { process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

async function parseThroughApi(input) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${process.env.API_PORT || 3001}/api/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw Object.assign(new Error('本地解析服务未连接或请求超时，请先启动 npm.cmd run dev:standalone。'), { code: 'LOCAL_API_UNAVAILABLE' });
  }
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error?.message || '解析接口返回失败。'), { code: payload.error?.code || 'LOCAL_API_ERROR' });
  return parseResponseSchema.parse(payload);
}

try {
  const result = await parseThroughApi(signupRequest);
  assert.equal(result.action.deadline, '2026-10-07T12:00:00+08:00');
  assert.equal(result.notification.eventStartTime, '2026-10-08T20:00:00+08:00');
  assert.equal(toDateTimeInput(result.action.remindAt), '2026-10-07T11:30');
  assert.match(result.action.title || '', /报名/);
  console.log(JSON.stringify({ verified: true, referenceDate: signupRequest.referenceDate, result }, null, 2));
  const competition = await parseThroughApi(competitionRequest);
  assert.match(competition.notification.title, /数学建模/);
  assert.match(competition.action.title || '', /报名/);
  assert.equal(competition.action.deadline, null);
  assert.equal(competition.action.remindAt, null);
  assert.equal(competition.notification.eventStartTime, null);
  assert.ok(competition.warnings.length > 0);
  assert.match(competition.warnings.join(''), /23:59/);
  assert.match(competition.warnings.join(''), /9:00/);
  assert.match(competition.notification.location, /数模竞赛管理系统.*作品提交栏/);
  assert.ok(competition.notification.links.includes('https://mathcomp.example.edu.cn/signup'));
  console.log(JSON.stringify({ verified: true, sample: '完整竞赛示例（日期需人工补齐）', referenceDate: competitionRequest.referenceDate, result: competition }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ verified: false, code: error.code || 'ACCEPTANCE_FAILED', message: error.message }, null, 2));
  process.exitCode = 1;
}
