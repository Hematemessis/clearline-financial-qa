import test from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSIONS, prepareDialogue, validateReport } from '../lib/rules.mjs';
import { normalizeScenario, rulesFor } from '../lib/policy.mjs';
import { recordReview, formatReport } from '../public/review.js';
import { analyze, callModel } from '../lib/model.mjs';
const turns=prepareDialogue('销售：这只基金保证本金不会亏。\n客户：你保证吗？');
const finding=(extra={})=>({turnId:'T1',quote:'保证本金不会亏',reason:'明确保本表达',suggestion:'投资存在本金损失风险',needsReview:false,severity:'high',ruleIds:[],...extra});
const base=()=>({dimensions:DIMENSIONS.map(d=>({id:d.id,status:d.id==='returns'?'high':'pass',reason:'测试理由',findings:d.id==='returns'?[finding()]:[]}))});
const scene=(date='2026-09-24',product='fund')=>normalizeScenario({product,channel:'online',dialogueDate:date},'2026-10-01');
test('有效高风险不被同维度客户错误证据连带降级',()=>{
  const raw=base(); raw.dimensions[0].findings.push(finding({turnId:'T2',quote:'你保证吗？'}));
  const r=validateReport(raw,turns,scene()); assert.equal(r.overall,'high'); assert.equal(r.dimensions[0].findings.length,1); assert.equal(r.dimensions[0].findings[0].needsReview,false); assert.equal(r.dimensions[0].needsReview,true);
});
test('同维度高风险与不确定项分别保留等级',()=>{
  const raw=base();raw.dimensions[0].findings.push(finding({needsReview:true}));
  const r=validateReport(raw,turns,scene());assert.equal(r.overall,'high');assert.deepEqual(r.dimensions[0].findings.map(f=>f.severity),['high','remind']);
});
test('规则生效日期边界及未知产品、线下渠道不扩大适用',()=>{
  assert.ok(!rulesFor(scene()).active.some(r=>r.id==='NET-01'));
  assert.ok(rulesFor(scene()).upcoming.some(r=>r.id==='NET-01'));
  assert.ok(rulesFor(scene('2026-09-30')).active.some(r=>r.id==='NET-01'));
  assert.ok(!rulesFor(scene('2026-10-01','unknown')).active.some(r=>r.id.startsWith('FUND')||r.id.startsWith('NET')));
  assert.ok(!rulesFor({...scene('2026-10-01'),channel:'offline'}).active.some(r=>r.id.startsWith('NET')));
});
test('伪造、不适用、跨维度条款只使对应项复核',()=>{
  for(const id of ['fake','NET-01','SEC-02']) {
    const raw=base();raw.dimensions[0].findings.push(finding({ruleIds:[id]}));
    const r=validateReport(raw,turns,scene());assert.equal(r.overall,'high');assert.equal(r.dimensions[0].findings[1].severity,'remind');assert.equal(r.dimensions[0].findings[1].references.length,0);
  }
});
test('达到四项时明确提示覆盖上限',()=>{const raw=base();raw.dimensions[0].findings=Array.from({length:4},()=>finding());assert.ok(validateReport(raw,turns,scene()).warnings.some(w=>w.includes('输出上限')));});
test('拒绝不合法和未来的对话日期及非法场景',()=>{
  for(const input of [{dialogueDate:'2026-02-30'},{dialogueDate:'2026-09-25'},{product:'injected'},null])assert.throws(()=>normalizeScenario(input,'2026-09-24'));
});
test('模型请求只包含场景适用且当时生效的规则',async()=>{
  await analyze(turns,{endpoint:'https://example.com',model:'test',apiKey:'test'},{fetchImpl:async(u,o)=>{
    const messages=JSON.parse(o.body).messages;const data=JSON.parse(messages[1].content.split('\n').slice(1).join('\n'));
    assert.equal(data.scenario.product,'fund');assert.ok(data.applicableRules.some(r=>r.id==='FUND-01'));assert.ok(!data.applicableRules.some(r=>r.id==='NET-01'));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(base())}}]}));
  }},scene());
});
test('人工复核保留历史和原始AI结论，导出包含理由时间与条款',()=>{
  const raw=base();raw.dimensions[0].findings[0].ruleIds=['FUND-01'];
  const report={...validateReport(raw,turns,scene()),turns,model:'synthetic',createdAt:'2026-09-24T01:00:00Z'};
  const f=report.dimensions[0].findings[0];
  assert.throws(()=>recordReview(f,'false_positive',''));
  recordReview(f,'materials','需核对合同','2026-09-24T01:01:00Z'); recordReview(f,'confirmed','合同已核对，保本表达不当','2026-09-24T01:02:00Z');
  assert.equal(report.overall,'high');assert.equal(f.reviewHistory.length,2);
  const text=formatReport(report);for(const word of ['需核对合同','合同已核对','FUND-01','2026-09-24T01:02:00Z','尚未生效','未完成'])assert.ok(text.includes(word));
});
test('模型调用接受取消信号',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(callModel({endpoint:'https://example.com',model:'test',apiKey:'test'},[],{signal:controller.signal,fetchImpl:async(u,o)=>{assert.ok(o.signal.aborted);throw new DOMException('Cancelled','AbortError');}}));
});
