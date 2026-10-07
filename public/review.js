export const REVIEW_LABELS = { pending:'未复核', confirmed:'确认风险', false_positive:'判为误报', materials:'待补材料', checked:'已核对当前片段' };
export function recordReview(target, decision, note, at = new Date().toISOString()) {
  if (!Object.hasOwn(REVIEW_LABELS, decision) || decision === 'pending') throw new Error('请选择复核结论。');
  if (typeof note !== 'string' || !note.trim() || note.length > 600) throw new Error('请填写复核理由或需补材料（最多 600 字）。');
  target.reviewHistory ??= [];
  const review = { decision, note:note.trim(), at };
  target.reviewHistory.push(review); target.review = review;
  return review;
}
export function reviewLines(target) {
  return target.reviewHistory?.length ? target.reviewHistory.map((r, i) => `- 复核记录 ${i + 1}：${REVIEW_LABELS[r.decision]}；${r.at}；${r.note.replace(/\r?\n/g, ' / ')}`) : ['- 人工复核：未完成'];
}
export function formatReport(report) {
  const labels = { pass:'通过', remind:'提醒', high:'高风险' };
  const lines = ['# 金融销售对话质检报告', '', `模型：${report.model}；分析时间：${report.createdAt}；规则版本：${report.ruleVersion}`, `AI 总体风险：${labels[report.overall]}（仅当前片段，人工复核不覆盖原始 AI 结果）`, `审核场景：${report.scenarioLabel || '未确定'}；对话日期：${report.scenario?.dialogueDate || '未确定'}`, '', report.coverage || '', '复核为本机人工记录，未经身份认证，不属于机构审批签章。', ''];
  for (const d of report.dimensions) {
    lines.push(`## ${d.name}：${labels[d.status]}`, '', d.reason);
    if (!d.findings.length) lines.push(...reviewLines(d));
    for (const [i,f] of d.findings.entries()) {
      lines.push('', `### 风险项 ${i+1}：${labels[f.severity || d.status]}`, `- 证据（${f.turnId}，销售）：${f.quote}`, `- 理由：${f.reason}`, `- 建议：${f.suggestion}`, `- AI 需复核：${f.needsReview ? '是' : '否；仍需人工确认'}`, ...reviewLines(f));
      for (const r of f.references || []) lines.push(`- 参考依据：${r.id} ${r.source}；生效：${r.effective}；${r.url}`);
      if (!f.references?.length) lines.push('- 未关联具体法规条款；仅为表达风险提示。');
    }
  }
  lines.push('', '## 规则范围');
  for (const r of report.policy?.active || []) lines.push(`- 本次检查参考：${r.id} ${r.source}；生效：${r.effective}；${r.url}`);
  for (const r of report.policy?.upcoming || []) lines.push(`- 对话日期尚未生效，不作当时违规依据：${r.id} ${r.source}；生效：${r.effective}；${r.url}`);
  if (report.warnings.length) lines.push('', '## 校验提醒', ...report.warnings);
  lines.push('', '## 分析文本（基础脱敏）', ...report.turns.map(t => `${t.id} ${t.role}：${t.text}`));
  return lines.join('\n');
}
