import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DIMENSIONS, parseDialogue, prepareDialogue, redactSensitive, parseModelJson, validateReport } from '../lib/rules.mjs';
import { resolveConfig, callModel } from '../lib/model.mjs';

const base = () => ({ dimensions: DIMENSIONS.map(d => ({ id: d.id, status: 'pass', reason: '当前片段未发现风险。', findings: [] })) });
const finding = (overrides = {}) => ({ turnId: 'T1', quote: '保证赚钱', reason: '明确保证收益。', suggestion: '不保证收益，投资可能亏损。', needsReview: false, ...overrides });
const turns = parseDialogue('销售：本产品保证赚钱。\n客户：你保证赚钱？');

test('角色解析支持中英文冒号、空行并保留原文行号', () => {
  const parsed = parseDialogue('销售: 不保证收益\n\n客户：好的');
  assert.equal(parsed[0].role, '销售'); assert.equal(parsed[1].line, 3); assert.equal(parsed[1].id, 'T2');
});
test('无法识别角色和无销售对话必须失败，不能猜测角色', () => {
  for (const text of ['客户：保证赚钱', '经理：保证赚钱', '销售：', '销售：你好\n继续内容', '']) assert.throws(() => parseDialogue(text));
});
test('拒绝超长文本和过多发言', () => {
  assert.throws(() => parseDialogue('销售：' + '好'.repeat(16000)));
  assert.throws(() => parseDialogue(Array(161).fill('销售：好').join('\n')));
});
test('敏感信息在提交前脱敏并保留语义', () => {
  const result = redactSensitive('手机号13800000000 身份证110101200001011234 账号6222000000000000 验证码：123456 密码是abc123');
  for (const value of ['13800000000', '110101200001011234', '6222000000000000', '123456', 'abc123']) assert.ok(!result.includes(value));
  assert.ok(result.includes('验证码')); assert.ok(prepareDialogue('销售：请不要提供验证码123456')[0].text.includes('[凭证已脱敏]'));
});
test('模型 JSON 支持普通对象及代码围栏，拒绝夹带解释与无效 JSON', () => {
  assert.deepEqual(parseModelJson('```json\n{"dimensions":[]}\n```'), { dimensions: [] });
  assert.throws(() => parseModelJson('我认为：{"dimensions":[]}'));
  assert.throws(() => parseModelJson(null));
});
test('五维度均通过时总体低风险', () => { assert.equal(validateReport(base(), turns).overall, 'pass'); });
test('有有效销售证据的高风险决定总体风险', () => {
  const raw = base(); raw.dimensions[0].status = 'high'; raw.dimensions[0].findings = [finding()];
  assert.equal(validateReport(raw, turns).overall, 'high');
});
test('客户证据不能归责销售：移除证据并降级复核', () => {
  const raw = base(); raw.dimensions[0].status = 'high'; raw.dimensions[0].findings = [finding({ turnId: 'T2' })];
  const actual = validateReport(raw, turns); assert.equal(actual.overall, 'remind'); assert.equal(actual.dimensions[0].findings.length, 0); assert.equal(actual.warnings.length, 1);
});
test('编造引用、错编号、非连续摘录不能通过证据校验', () => {
  for (const f of [finding({ quote: '绝对不亏' }), finding({ turnId: 'T9' }), finding({ quote: '本产品赚钱' })]) {
    const raw = base(); raw.dimensions[0].status = 'high'; raw.dimensions[0].findings = [f];
    assert.equal(validateReport(raw, turns).overall, 'remind');
  }
});
test('证据不足不能给出高风险；不确定证据转复核', () => {
  const raw = base(); raw.dimensions[0].status = 'high'; assert.equal(validateReport(raw, turns).overall, 'remind');
  raw.dimensions[0].findings = [finding({ needsReview: true })]; assert.equal(validateReport(raw, turns).overall, 'remind');
});
test('通过与风险点矛盾时不能输出通过', () => {
  const raw = base(); raw.dimensions[0].findings = [finding()]; const result = validateReport(raw, turns);
  assert.equal(result.overall, 'remind'); assert.ok(result.dimensions[0].findings[0].needsReview);
});
test('缺维度、重复维度、错误状态、缺建议等输出拒绝处理', () => {
  const missing = base(); missing.dimensions.pop();
  const duplicate = base(); duplicate.dimensions[1].id = 'returns';
  const wrong = base(); wrong.dimensions[0].status = 'safe';
  const noSuggestion = base(); noSuggestion.dimensions[0].findings = [finding({ suggestion: '' })];
  for (const raw of [null, {}, missing, duplicate, wrong, noSuggestion]) assert.throws(() => validateReport(raw, turns));
});
test('16 组自制对话均可解析；角色与否定原文保持不变', async () => {
  const samples = JSON.parse(await readFile(new URL('../samples/cases.json', import.meta.url), 'utf8'));
  assert.equal(samples.length, 16); for (const s of samples) assert.ok(prepareDialogue(s.text).length >= 2);
  const badcase = samples.find(s => s.id === 'badcase');
  assert.ok(prepareDialogue(badcase.text)[1].text.startsWith('我们不保证收益'));
  // 这是数据准备测试，不是对真实模型语义判断的测试。
});
test('Base URL 保留前缀并支持完整端点', () => {
  for (const baseUrl of ['https://example.com/v1/', 'https://example.com/v1/chat/completions']) assert.equal(resolveConfig({ baseUrl, model: 'demo', apiKey: 'test' }).endpoint, 'https://example.com/v1/chat/completions');
});
test('模型配置不完整、非 HTTPS 远程地址、嵌入账号或查询参数被拒绝', () => {
  assert.throws(() => resolveConfig({}));
  for (const baseUrl of ['http://example.com/v1', 'file:///tmp', 'https://user:pass@example.com', 'https://example.com?a=b', 'https://example.com/#x']) assert.throws(() => resolveConfig({ baseUrl, model: 'demo', apiKey: 'test' }));
  assert.ok(resolveConfig({ baseUrl: 'http://127.0.0.1:9999/v1', model: 'demo', apiKey: 'test' }));
});
test('环境密钥与页面地址不能交叉组合', () => {
  const env = { MODEL_BASE_URL: 'https://trusted.example/v1', MODEL_API_KEY: 'environment-secret', MODEL_NAME: 'demo' };
  assert.throws(() => resolveConfig({ baseUrl: 'https://other.example/v1', model: 'demo' }, env));
  assert.equal(resolveConfig({ source: 'env', baseUrl: 'https://other.example/v1' }, env).endpoint, 'https://trusted.example/v1/chat/completions');
});
test('模型连接只向指定地址携带密钥，禁用重定向', async () => {
  const config = resolveConfig({ baseUrl: 'https://example.com/v1', model: 'demo', apiKey: 'test-key' });
  await callModel(config, [{ role: 'user', content: 'OK' }], { fetchImpl: async (url, options) => {
    assert.equal(url, config.endpoint); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer test-key');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  } });
});
test('上游错误不透传密钥、原文或原始错误响应', async () => {
  await assert.rejects(callModel({ endpoint: 'https://example.com', model: 'demo', apiKey: 'test' }, [], { fetchImpl: async () => new Response('secret-and-customer-text', { status: 401 }) }), error => error.message.includes('401') && !error.message.includes('secret-and-customer-text'));
});
test('HTTP 400 明确提示模型 ID 和接口参数，不误报服务不可用且不透传原始响应', async () => {
  await assert.rejects(callModel({ endpoint: 'https://example.com', model: 'invalid-model', apiKey: 'synthetic-secret' }, [], {
    fetchImpl: async () => new Response('synthetic-secret and private dialogue', { status: 400 })
  }), error => error.message.includes('完整 API 模型 ID') && !error.message.includes('服务暂时不可用') && !error.message.includes('synthetic-secret') && !error.message.includes('private dialogue'));
});
test('超时、空响应、截断、非 JSON 响应均返回受控错误', async () => {
  const config = { endpoint: 'https://example.com', model: 'demo', apiKey: 'test' };
  await assert.rejects(callModel(config, [], { fetchImpl: async () => { const e = new Error(); e.name = 'TimeoutError'; throw e; } }), e => e.code === 'MODEL_TIMEOUT');
  for (const text of ['not-json', '{}', JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })]) await assert.rejects(callModel(config, [], { fetchImpl: async () => new Response(text) }));
});
