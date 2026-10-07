import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { prepareDialogue, RULE_VERSION } from '../lib/rules.mjs';
import { resolveConfig, analyze } from '../lib/model.mjs';

// 读取完整环境配置，不输出地址或密钥；仅分析仓库内的自制样例。
let config;
try { config = resolveConfig({ source: 'env' }); } catch (e) { console.error(e.message); process.exit(1); }
const cases = JSON.parse(await readFile(new URL('../samples/cases.json', import.meta.url), 'utf8'));
const results = [];
for (const sample of cases) {
  console.log(`正在分析自制样例：${sample.id}`);
  const started = Date.now();
  try {
    const report = await analyze(prepareDialogue(sample.text), config);
    results.push({ id: sample.id, name: sample.name, expected: sample.expected, result: report, durationMs: Date.now() - started, review: '待人工逐条对照预期，接口成功不代表判断正确。' });
  } catch (e) { results.push({ id: sample.id, name: sample.name, expected: sample.expected, error: e.message, review: '分析失败，请排查配置或服务。' }); }
}
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const timestamp = new Date().toISOString();
const path = new URL('../test-results/live-results.json', import.meta.url);
await writeFile(path, JSON.stringify({ timestamp, model: config.model, ruleVersion: RULE_VERSION, results }, null, 2));
const lines = ['# 真实模型实测记录', '', `时间：${timestamp}`, `模型：${config.model}`, `规则版本：${RULE_VERSION}`, '', '以下为实际调用结果；最终正确性仍需人工对照预期复核。', ''];
for (const r of results) {
  lines.push(`## ${r.id} / ${r.name}`, '', `预期：${r.expected}`, '', `实际：${r.error || r.result.overall}`, '', r.review, '');
  if (r.result) for (const d of r.result.dimensions) { lines.push(`- ${d.name}：${d.status}；${d.reason}`); for (const f of d.findings) lines.push(`  - ${f.turnId}：${f.quote}；理由：${f.reason}；建议：${f.suggestion}`); }
  lines.push('');
}
await writeFile(new URL('../test-results/live-results.md', import.meta.url), lines.join('\n'));
console.log('已保存 test-results/live-results.json 与 live-results.md。请人工复核并将结论补入 TEST_CASES.md；文件不含密钥。');
