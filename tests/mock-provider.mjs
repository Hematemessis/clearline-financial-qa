// 仅用于 UI/接口工程验证，无语义理解能力，不得作为模型准确率证据。
import http from 'node:http';
import { DIMENSIONS } from '../lib/rules.mjs';
const server = http.createServer(async (req, res) => {
  let input = ''; for await (const chunk of req) input += chunk;
  const payload = JSON.parse(input);
  if (payload.model === 'MOCK-error') { res.writeHead(401); res.end('synthetic error'); return; }
  let content = 'OK';
  if (payload.messages?.length > 1) {
    const dimensions = DIMENSIONS.map(d => ({ id: d.id, status: 'pass', reason: '测试替身固定结果：仅检查页面渲染，不能用于评估语义准确率。', findings: [] }));
    dimensions[0] = { id: 'returns', status: 'high', reason: '测试替身固定结果：用于验证高风险报告渲染。', findings: [{ turnId: 'T1', quote: '这款产品保证本金安全，每个月稳赚 3%，绝对不会亏。', reason: '固定测试证据，用于检验原文关联。', suggestion: '不保证本金安全或收益，投资可能发生亏损，请阅读风险揭示材料。', needsReview: false }] };
    dimensions[3] = { id: 'suitability', status: 'remind', reason: '测试替身：需要人工复核适当性资料。', findings: [] };
    if (payload.model === 'MOCK-navigation') {
      // 固定证据定位夹具，只用于验证长对话滚动、同句重复与跨发言切换。
      const data = JSON.parse(payload.messages[1].content.split('\n').slice(1).join('\n'));
      const sales = data.turns.filter(t => t.role === '销售');
      dimensions[0].findings[0].turnId = sales[0].id;
      dimensions[0].findings[0].quote = '保证赚钱';
      dimensions[2] = { id: 'trading', status: 'high', reason: '固定导航测试证据，非模型判断。', findings: [{ turnId: sales.at(-1).id, quote: '把验证码发给我。', reason: '用于检验末尾发言定位。', suggestion: '请勿提供验证码。', needsReview: false }] };
    }
    content = JSON.stringify({ dimensions });
  }
  setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })); }, 1800);
});
server.listen(8788, '127.0.0.1', () => console.log('UI 测试替身 http://127.0.0.1:8788/v1；无真实模型能力，按 Ctrl+C 停止。'));
