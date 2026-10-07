import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { DIMENSIONS } from '../lib/rules.mjs';

const config = { baseUrl: 'https://example.com/v1', model: 'fixture-model', apiKey: 'synthetic-test-key' };
const fixture = () => ({ dimensions: DIMENSIONS.map(d => ({ id: d.id, status: d.id === 'returns' ? 'high' : 'pass', reason: '测试替身固定输出，仅验证工程链路。', findings: d.id === 'returns' ? [{ turnId: 'T1', quote: '保证赚钱', reason: '测试证据', suggestion: '不保证收益', needsReview: false }] : [] })) });
async function start(t, options = {}) {
  const server = createApp(options); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  return { url, post };
}
test('本地首页、样例与配置接口可访问；环境密钥不返回浏览器', async t => {
  const { url } = await start(t, { env: { MODEL_API_KEY: 'never-return-this', MODEL_BASE_URL: 'https://example.com/v1', MODEL_NAME: 'demo' } });
  const page = await fetch(url); assert.equal(page.status, 200); assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'")); assert.ok((await page.text()).includes('清言'));
  const info = await (await fetch(url + '/api/info')).text(); assert.ok(!info.includes('never-return-this')); assert.equal(JSON.parse(info).envConfigured, true);
  assert.equal((await (await fetch(url + '/api/samples')).json()).length, 16);
  assert.equal((await fetch(url + '/.env')).status, 404);
});
test('无配置返回明确状态，不能伪装分析成功', async t => {
  const { post } = await start(t, { env: {} }); const res = await post('/api/analyze', { text: '销售：你好', config: {} });
  assert.equal(res.status, 400); assert.equal((await res.json()).code, 'MODEL_NOT_CONFIGURED');
});
test('跨站与非本机 Host 请求被拒绝', async t => {
  const { url, post } = await start(t);
  assert.equal((await post('/api/test', { config }, { Origin: 'https://untrusted.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
});
test('完整分析链路可返回校验报告，输入敏感信息已脱敏（测试替身）', async t => {
  const { post } = await start(t, { modelOptions: { fetchImpl: async (url, options) => {
    assert.ok(!options.body.includes('13800000000')); assert.ok(options.body.includes('[手机号已脱敏]'));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fixture()) } }] }));
  } } });
  const res = await post('/api/analyze', { config, text: '销售：保证赚钱。\n客户：我的手机号13800000000' });
  assert.equal(res.status, 200); const result = await res.json(); assert.equal(result.overall, 'high'); assert.equal(result.dimensions.length, 5); assert.ok(!JSON.stringify(result).includes('synthetic-test-key'));
});
test('连接测试成功与分析成功是独立接口（测试替身）', async t => {
  const { post } = await start(t, { modelOptions: { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })) } });
  const result = await (await post('/api/test', { config })).json(); assert.equal(result.ok, true); assert.ok(result.message.includes('不代表质检准确率'));
  assert.equal((await post('/api/analyze', { config, text: '销售：你好' })).status, 502);
});
test('格式错误在模型调用前失败', async t => {
  let called = false; const { post } = await start(t, { modelOptions: { fetchImpl: async () => { called = true; throw new Error(); } } });
  assert.equal((await post('/api/analyze', { config, text: '不知道是谁：保证收益' })).status, 400); assert.equal(called, false);
});
test('模型 401 错误不会泄露上游敏感响应（测试替身）', async t => {
  const { post } = await start(t, { modelOptions: { fetchImpl: async () => new Response('synthetic-test-key', { status: 401 }) } });
  const res = await post('/api/test', { config }); const text = await res.text(); assert.equal(res.status, 502); assert.ok(!text.includes('synthetic-test-key')); assert.ok(text.includes('401'));
});

test('用户取消分析时后端中止上游，并释放请求占用', async t => {
  let entered, aborted;
  const started = new Promise(resolve => { entered = resolve; });
  const stopped = new Promise(resolve => { aborted = resolve; });
  const { url, post } = await start(t, { modelOptions:{ fetchImpl:async (url, options) => {
    if (JSON.parse(options.body).messages.length === 1) return new Response(JSON.stringify({ choices:[{message:{content:'OK'}}] }));
    entered();
    return new Promise((resolve,reject) => options.signal.addEventListener('abort',()=>{ aborted();reject(new DOMException('Cancelled','AbortError')); },{once:true}));
  } } });
  const controller = new AbortController();
  const request=fetch(url+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,text:'销售：保证赚钱'}),signal:controller.signal});
  const rejection=assert.rejects(request);
  await started; controller.abort(); await rejection;
  await Promise.race([stopped,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Cancellation did not propagate')),2000);timer.unref();})]);
  assert.equal((await post('/api/test',{config})).status,200);
});
