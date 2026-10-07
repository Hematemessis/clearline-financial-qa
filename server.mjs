import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AppError, DIMENSIONS, prepareDialogue } from './lib/rules.mjs';
import { resolveConfig, callModel, analyze } from './lib/model.mjs';
import { normalizeScenario } from './lib/policy.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/review.js': ['review.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const securityHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function json(res, status, data) { res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('仅接受 JSON 请求。', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length; if (size > 180000) throw new AppError('请求过大。', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('请求不是有效 JSON。'); }
}

export function createApp({ env = process.env, modelOptions } = {}) {
  let busy = false;
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new AppError('仅允许本机访问。', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new AppError('不允许跨站请求。', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('不允许跨站请求。', 403);
      const pathname = new URL(req.url, `http://${host}`).pathname;
      if (req.method === 'GET' && FILES[pathname]) {
        const [file, mime] = FILES[pathname];
        res.writeHead(200, { ...securityHeaders, 'Content-Type': mime });
        res.end(await readFile(path.join(root, 'public', file))); return;
      }
      if (req.method === 'GET' && pathname === '/api/info') {
        json(res, 200, { dimensions: DIMENSIONS, envConfigured: !!(env.MODEL_API_KEY && env.MODEL_BASE_URL && env.MODEL_NAME) }); return;
      }
      if (req.method === 'GET' && pathname === '/api/samples') {
        const samples = JSON.parse(await readFile(path.join(root, 'samples', 'cases.json'), 'utf8'));
        json(res, 200, samples); return;
      }
      if (req.method !== 'POST' || !['/api/analyze', '/api/test'].includes(pathname)) { json(res, 404, { error: '页面或接口不存在。' }); return; }
      const payload = await body(req);
      if (!payload || typeof payload !== 'object') throw new AppError('请求体格式错误。');
      const config = resolveConfig(payload.config, env);
      if (busy) throw new AppError('已有模型请求进行中，请等待完成后重试。', 429, 'BUSY');
      const turns = pathname === '/api/analyze' ? prepareDialogue(payload.text) : null;
      let scenario;
      try { scenario = normalizeScenario(payload.scenario); } catch (error) { throw new AppError(error.message); }
      busy = true;
      const start = Date.now();
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', cancel);
      try {
        if (pathname === '/api/test') {
          await callModel(config, [{ role: 'user', content: 'Reply with OK.' }], { ...modelOptions, timeoutMs: modelOptions?.timeoutMs ?? 15000 });
          json(res, 200, { ok: true, message: '连接成功，模型已返回非空响应。连接测试不代表质检准确率已验证。', durationMs: Date.now() - start });
        } else {
          const report = await analyze(turns, config, { ...modelOptions, signal:controller.signal }, scenario);
          json(res, 200, { ...report, turns, mode: 'live', model: config.model, createdAt: new Date().toISOString(), durationMs: Date.now() - start });
        }
      } finally { busy = false; res.off('close', cancel); }
    } catch (error) {
      // 禁止打印请求、密钥、上游原始响应或异常对象。
      json(res, error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.message : '本地服务异常，请重试。', code: error.code || 'INTERNAL_ERROR' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('PORT 必须是有效端口号。'); process.exit(1); }
  const server = createApp();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请修改 PORT。` : '本地服务启动失败。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`清言质检已启动：http://127.0.0.1:${port}（按 Ctrl+C 停止）`));
}
