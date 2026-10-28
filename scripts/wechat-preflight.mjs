// A0 预检：在服务器上运行，确认「配置齐全 + 出网可用 + IP 未被拦」
// 用法：node scripts/wechat-preflight.mjs
// 只输出布尔与错误码，任何情况下都不打印密钥原值。

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(ROOT, '.env.wechat.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const cfg = {
  corpId: process.env.WECOM_CORP_ID || '',
  secret: process.env.WECOM_SECRET || '',
  token: process.env.WECOM_TOKEN || '',
  aesKey: process.env.WECOM_ENCODING_AES_KEY || '',
  openKfId: process.env.WECOM_OPEN_KFID || '',
  publicUrl: process.env.WECHAT_GATE_PUBLIC_URL || '',
  testers: process.env.WECHAT_GATE_TESTER_IDS || '',
};

const problems = [];
const warnings = [];
const ok = (label, extra = '') => console.log(`  OK   ${label}${extra ? '  ' + extra : ''}`);
const bad = (label, extra = '') => { console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`); problems.push(label); };
const warn = (label, extra = '') => { console.log(`  WARN ${label}${extra ? '  ' + extra : ''}`); warnings.push(label); };

console.log('== 1. 配置文件 ==');
if (!existsSync(envFile)) {
  bad('找不到 .env.wechat.local');
  console.log(`       请在 ${ROOT} 下创建：cp .env.wechat.example .env.wechat.local`);
} else {
  ok('已找到 .env.wechat.local');
  console.log(`       WECOM_CORP_ID             ${cfg.corpId ? '已填 ' + cfg.corpId.length + ' 字符' : '空'}`);
  console.log(`       WECOM_SECRET             ${cfg.secret ? '已填 ' + cfg.secret.length + ' 字符' : '空'}`);
  console.log(`       WECOM_TOKEN              ${cfg.token ? '已填 ' + cfg.token.length + ' 字符' : '空'}`);
  console.log(`       WECOM_ENCODING_AES_KEY   ${cfg.aesKey ? '已填 ' + cfg.aesKey.length + ' 字符' : '空'}`);
  console.log(`       WECOM_OPEN_KFID          ${cfg.openKfId ? '已填 ' + cfg.openKfId.length + ' 字符' : '空'}`);
  console.log(`       WECHAT_GATE_TESTER_IDS   ${cfg.testers ? cfg.testers.split(',').filter(Boolean).length + ' 个' : '空（收到消息也不会回复）'}`);
}

console.log('\n== 2. 配置合法性 ==');
if (cfg.corpId && cfg.secret && cfg.token && cfg.aesKey && cfg.openKfId) ok('五项必要配置齐全');
else bad('五项必要配置不齐', '网关调用会直接失败');

if (cfg.aesKey && cfg.aesKey.length !== 43) bad('EncodingAESKey 长度应为 43', `当前 ${cfg.aesKey.length}`);
else if (cfg.aesKey) ok('EncodingAESKey 长度 43');

if (cfg.token && (cfg.token.length < 3 || cfg.token.length > 32)) bad('Token 长度应为 3-32', `当前 ${cfg.token.length}`);
else if (cfg.token) ok('Token 长度合法');

if (!cfg.testers.split(',').filter(Boolean).length) warn('白名单为空，联调阶段收不到任何回复');

console.log('\n== 3. 回调地址 ==');
if (!cfg.publicUrl) {
  warn('WECHAT_GATE_PUBLIC_URL 为空', '后台填的 URL 请手动核对一致性');
} else {
  console.log(`       当前值：${cfg.publicUrl}`);
  const host = (() => { try { return new URL(cfg.publicUrl).hostname; } catch { return ''; } })();
  if (!host) bad('URL 无法解析');
  else if (/trycloudflare\.com$|workers\.dev$|ngrok|natapp|cpolar/i.test(host)) {
    bad('这是第三方隧道的域名', '未认证企业必须用公网 IP，此类域名必然报 -50025');
  } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) ok('公网 IP 形式（未认证企业允许）');
  else ok('域名形式', '需确认备案主体与企业微信认证主体一致');
  if (!/\/wechat\/callback$/.test(cfg.publicUrl)) warn('路径不是 /wechat/callback');
}

console.log('\n== 4. 公网出口 IP ==');
let egressIp = '';
try {
  const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) });
  egressIp = (await r.json()).ip || '';
  ok('出口 IP', egressIp);
  if (cfg.publicUrl) {
    const host = (() => { try { return new URL(cfg.publicUrl).hostname; } catch { return ''; } })();
    if (host && host !== egressIp) warn('出口 IP 与回调 IP 不一致', '云服务器多网卡/弹性IP时正常；否则需确认');
  }
} catch (e) {
  warn('取不到出口 IP', e.message);
}

console.log('\n== 5. 官方接口连通性 ==');
let token = '';
try {
  const r = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corpId)}&corpsecret=${encodeURIComponent(cfg.secret)}`,
    { signal: AbortSignal.timeout(10000) },
  );
  const d = await r.json();
  if (d.errcode === 0) { token = d.access_token; ok('gettoken 成功'); }
  else if (d.errcode === 60020) {
    bad('gettoken 被 IP 限制 (60020)', '需在后台配置「企业可信 IP」');
    console.log('       路径：企业微信管理后台 → 应用管理 → 微信客服 → 企业可信 IP');
    console.log(`       填入：${egressIp || '本机公网出口 IP'}`);
  } else {
    bad(`gettoken 失败 ${d.errcode}`, d.errmsg || '');
    if (d.errcode === 40013) console.log('       → 企业 ID 不对');
    if (d.errcode === 40001 || d.errcode === 40091) console.log('       → Secret 不对，或与微信客服应用不匹配');
  }
} catch (e) {
  bad('gettoken 网络异常', e.message);
}

if (token) {
  try {
    const r = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/kf/account/list?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: 0, limit: 100 }), signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    if (d.errcode === 0) {
      const list = d.account_list || [];
      ok('kf/account/list 成功', `${list.length} 个客服账号`);
      const hit = list.some(a => a.open_kfid === cfg.openKfId);
      if (hit) ok('WECOM_OPEN_KFID 与可访问账号匹配');
      else {
        bad('WECOM_OPEN_KFID 不在可访问账号中', '网关会忽略所有消息');
        list.forEach(a => console.log(`       可访问：${a.open_kfid}  ${a.name || ''}`));
      }
    } else if (d.errcode === 60020) {
      bad('kf/account/list 被 IP 限制 (60020)', '配置企业可信 IP 后重跑');
    } else {
      bad(`kf/account/list 失败 ${d.errcode}`, d.errmsg || '');
    }
  } catch (e) {
    bad('kf/account/list 网络异常', e.message);
  }
}

console.log('\n== 6. 本机网关 ==');
try {
  const port = Number(process.env.WECHAT_GATE_PORT) || 3002;
  const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  const d = await r.json();
  ok('/health 可访问', `configured=${d.configured} allowedSenders=${d.allowedSenders}`);
  if (!d.configured) bad('网关认为配置不全');
} catch {
  warn('本机网关未运行', '启动：node server/wechat-gate.mjs');
}

console.log('\n== 结论 ==');
if (problems.length === 0) {
  console.log('  预检通过。可以回微信后台填回调 URL 并点保存。');
  console.log(`  URL 填：${cfg.publicUrl || 'http://<公网IP>:8080/wechat/callback'}`);
} else {
  console.log(`  有 ${problems.length} 项必须先解决：`);
  problems.forEach(p => console.log(`   - ${p}`));
  if (warnings.length) {
    console.log(`  另有 ${warnings.length} 项提醒：`);
    warnings.forEach(w => console.log(`   - ${w}`));
  }
  process.exitCode = 1;
}
