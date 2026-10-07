import { REVIEW_LABELS, recordReview, formatReport } from './review.js';
const $ = id => document.getElementById(id);
let analysisController, elapsedTimer, dirty = false, reviewDraftDirty = false;
const reviewDrafts = new Set();
window.addEventListener('beforeunload', event => { if (dirty || pending || reviewDraftDirty) { event.preventDefault(); event.returnValue = ''; } });
const today = new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Shanghai' });
$('dialogue-date').value = today; $('dialogue-date').max = today;
function scenario() { return { product:$('product').value, channel:$('channel').value, stage:$('stage').value, dialogueDate:$('dialogue-date').value }; }
function scenarioLabel() { return ['product','channel','stage'].map(id => $(id).selectedOptions[0].textContent).join(' / '); }
for (const id of ['product','channel','stage','dialogue-date']) { const field = $(id); field.dataset.previous=field.value; field.onchange = () => { if (!replaceAllowed()) { field.value=field.dataset.previous; return; } field.dataset.previous=field.value; clearReport(); $('input-message').textContent = '审核场景已改变，请重新分析。'; }; }
function replaceAllowed() { return (!dirty && !reviewDraftDirty) || window.confirm('当前报告或复核记录尚未导出，继续会清除它们。是否继续？'); }
function checkText() {
  const text = $('dialogue').value; let count = 0, sales = false, offset = 0;
  for (const [index, raw] of text.split('\n').entries()) {
    if (raw.trim()) {
      const match = raw.trim().match(/^(销售|客户)\s*[:：]\s*(.+)$/u);
      if (!match || !match[2].trim()) { $('dialogue').focus(); $('dialogue').setSelectionRange(offset, offset + raw.length); throw new Error(`第 ${index+1} 行格式不清楚，请以“销售：”或“客户：”开头，每段独占一行。`); }
      count++; sales ||= match[1] === '销售';
    }
    offset += raw.length + 1;
  }
  if (!sales) throw new Error('请至少输入一段销售发言。');
  if (count > 160) throw new Error('最多支持 160 段发言，请拆分后分析。');
  const date = $('dialogue-date').value;
  if (!date || date > today) throw new Error('请选择不晚于今天的对话日期。');
}
let config = { source: 'page', baseUrl: '', model: '', apiKey: '' };
let samples = []; let report = null; let pending = false; let toastTimer;
let selectedEvidence = null;
window.addEventListener('pageshow', () => {
  // 部分浏览器会恢复表单字段；主动清除模型配置，避免刷新后残留凭证。
  config = { source: 'page', baseUrl: '', model: '', apiKey: '' };
  for (const id of ['base-url', 'model-name', 'api-key']) $(id).value = '';
  $('api-key').type = 'password'; $('key-toggle').textContent = '显示'; $('key-toggle').setAttribute('aria-label', '显示密钥');
  $('use-env').checked = false; $('page-config').disabled = false; $('config-dot').classList.remove('ready');
  if ($('settings-dialog').open) $('settings-dialog').close();
  updateInput();
});
const LABEL = { pass: '通过', remind: '提醒', high: '高风险' };
const OVERALL = { pass: '低风险', remind: '需关注', high: '高风险' };
const ready = () => config.source === 'env' || [config.baseUrl, config.model, config.apiKey].every(x => x?.trim());
function el(tag, cls, value) { const node = document.createElement(tag); if (cls) node.className = cls; if (value !== undefined) node.textContent = value; return node; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200); }
function status(text, mode = '') { $('report-status').className = 'status-line ' + mode; $('report-status').replaceChildren(el('span', 'status-led'), el('span', '', text)); }
function showPane(name) { for (const id of ['empty-report', 'loading-report', 'error-report', 'report-content']) $(id).hidden = id !== name; }
function clearReport() {
  dirty = false; reviewDraftDirty = false; reviewDrafts.clear();
  report = null; selectedEvidence = null;
  $('export-btn').disabled = true; $('report-content').replaceChildren();
  $('source-reader').replaceChildren(); $('source-tabs').hidden = true;
  $('return-to-risk').hidden = true; document.querySelector('.workspace').classList.remove('reviewing');
  setSourceView('edit'); showPane('empty-report'); status('等待输入对话');
}
function setSourceView(mode) {
  const review = mode === 'review' && !!report;
  $('editor-pane').hidden = review; $('review-pane').hidden = !review;
  $('edit-tab').setAttribute('aria-selected', String(!review)); $('review-tab').setAttribute('aria-selected', String(review));
  $('edit-tab').tabIndex = review ? -1 : 0; $('review-tab').tabIndex = review ? 0 : -1;
}
$('edit-tab').onclick = () => setSourceView('edit');
$('review-tab').onclick = () => setSourceView('review');
$('source-tabs').onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const review = event.key === 'End' || (event.key !== 'Home' && $('review-tab').getAttribute('aria-selected') !== 'true');
  setSourceView(review ? 'review' : 'edit'); $(review ? 'review-tab' : 'edit-tab').focus();
};
function renderSource(turnId, quote) {
  $('source-reader').replaceChildren();
  for (const turn of report.turns) {
    const row = el('article', 'source-turn' + (turn.id === turnId ? ' is-active' : ''));
    row.id = `source-${turn.id}`; row.tabIndex = -1; row.setAttribute('aria-label', `${turn.id} ${turn.role}发言`);
    const heading = el('div', 'source-turn-heading');
    heading.append(el('span', 'source-turn-id', turn.id), el('strong', turn.role === '销售' ? 'sales-role' : '', turn.role), el('span', '', `原文第 ${turn.line} 行`));
    const text = el('p', 'source-turn-text');
    if (turn.id === turnId && quote && turn.text.includes(quote)) {
      const parts = turn.text.split(quote);
      parts.forEach((part, index) => { if (index) text.append(el('mark', 'source-highlight', quote)); text.append(document.createTextNode(part)); });
    } else text.textContent = turn.text;
    row.append(heading, text); $('source-reader').append(row);
  }
}
function locateEvidence(finding, button) {
  if (!report) return;
  const turn = report.turns.find(t => t.id === finding.turnId);
  if (!turn || turn.role !== '销售' || !turn.text.includes(finding.quote)) { toast('证据与当前原文不匹配，请重新分析。'); return; }
  selectedEvidence?.classList.remove('is-selected'); selectedEvidence?.setAttribute('aria-pressed', 'false');
  selectedEvidence = button; button.classList.add('is-selected'); button.setAttribute('aria-pressed', 'true');
  renderSource(turn.id, finding.quote); setSourceView('review');
  const occurrences = turn.text.split(finding.quote).length - 1;
  $('source-location').textContent = `已定位 ${turn.id} · 销售 · 原文第 ${turn.line} 行${occurrences > 1 ? `；该段有 ${occurrences} 处相同片段，均已高亮` : '，证据已高亮'}。`;
  $('return-to-risk').hidden = false;
  const target = $(`source-${turn.id}`);
  target.focus({ preventScroll: true });
  // 发言本身可能很长，滚动到引用片段而非仅滚到整段开头。
  (target.querySelector('mark') || target).scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
$('return-to-risk').onclick = () => { if (selectedEvidence?.isConnected) { selectedEvidence.focus({ preventScroll: true }); selectedEvidence.scrollIntoView({ block: 'center', behavior: 'instant' }); } };
function updateInput() { $('text-count').textContent = `${$('dialogue').value.length.toLocaleString()} / 16,000 字符`; clearReport(); $('input-message').textContent = ready() ? '' : '尚未配置模型，请先打开右上角“模型设置”。'; }
function setPending(value) {
  pending = value;
  for (const id of ['analyze-btn', 'clear-btn', 'upload-btn', 'dialogue', 'settings-open', 'scenario-fields']) $(id).disabled = value;
  document.querySelectorAll('.sample-chip').forEach(b => { b.disabled = value; });
  document.querySelector('.report-panel').setAttribute('aria-busy', String(value));
  $('analyze-btn').firstElementChild.textContent = value ? '正在分析…' : '开始质检';
}
async function api(path, data, timeout = 70000, signal) {
  let response;
  try { response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }); }
  catch (error) { if (signal?.aborted) throw new Error('分析已取消，未生成报告。'); throw new Error(error.name === 'TimeoutError' ? '本地请求超时，请稍后重试。' : '无法连接本地服务，请确认启动窗口仍在运行。'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('本地服务返回了无效响应。'); }
  if (!response.ok) { const error = new Error(result.error || '请求失败，请重试。'); error.code = result.code; throw error; }
  return result;
}
function openSettings() {
  $('connection-message').textContent = ''; $('settings-dialog').showModal();
  $('base-url').value = config.baseUrl || ''; $('model-name').value = config.model || ''; $('api-key').value = config.apiKey || '';
  $('use-env').checked = config.source === 'env'; $('page-config').disabled = config.source === 'env';
}
$('settings-open').onclick = openSettings;
$('error-settings').onclick = openSettings;
$('settings-close').onclick = () => $('settings-dialog').close();
$('use-env').onchange = () => { $('page-config').disabled = $('use-env').checked; };
$('key-toggle').onclick = () => { const visible = $('api-key').type === 'password'; $('api-key').type = visible ? 'text' : 'password'; $('key-toggle').textContent = visible ? '隐藏' : '显示'; $('key-toggle').setAttribute('aria-label', visible ? '隐藏密钥' : '显示密钥'); };
function draftConfig() { return $('use-env').checked ? { source: 'env' } : { source: 'page', baseUrl: $('base-url').value.trim(), model: $('model-name').value.trim(), apiKey: $('api-key').value.trim() }; }
function checkConfig(draft) {
  if (draft.source === 'env') return;
  if (![draft.baseUrl, draft.model, draft.apiKey].every(Boolean)) throw new Error('请完整填写 Base URL、Model Name 和 API Key。');
  const url = new URL(draft.baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入不含账号、查询参数和片段的 HTTP(S) Base URL。');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('非本机模型地址必须使用 HTTPS。');
}
$('settings-form').onsubmit = event => {
  event.preventDefault();
  try { const draft = draftConfig(); checkConfig(draft); config = draft; $('config-dot').classList.remove('ready'); $('settings-open').title = '已应用配置；实际连接以请求结果为准'; $('settings-dialog').close(); $('input-message').textContent = '模型配置已应用，下次分析时使用；已有报告保留其原始模型记录。'; toast('配置已应用，仅本次页面有效'); }
  catch (error) { $('connection-message').textContent = error.message; $('connection-message').className = 'error'; }
};
$('test-btn').onclick = async () => {
  const btn = $('test-btn');
  try {
    const draft = draftConfig(); checkConfig(draft); btn.disabled = true; $('connection-message').className = ''; $('connection-message').textContent = '正在测试连接…';
    const result = await api('/api/test', { config: draft }, 20000);
    $('connection-message').textContent = `${result.message}（${(result.durationMs / 1000).toFixed(1)} 秒）`;
    if (JSON.stringify(draft) === JSON.stringify(config)) { $('config-dot').classList.add('ready'); $('settings-open').title = '当前配置连接测试通过；不代表质检准确率'; }
  } catch (error) { $('connection-message').textContent = error.message; $('connection-message').className = 'error'; }
  finally { btn.disabled = false; }
};
$('dialogue').oninput = () => { $('sample-expectation').hidden = true; document.querySelectorAll('.sample-chip').forEach(b => b.classList.remove('active')); updateInput(); };
$('clear-btn').onclick = () => { if (!replaceAllowed()) return; $('dialogue').value = ''; $('dialogue').oninput(); $('dialogue').focus(); };
$('upload-btn').onclick = () => $('file-input').click();
$('file-input').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (!file.name.toLowerCase().endsWith('.txt') || file.size > 64000) throw new Error('请选择不超过 64 KB 的 UTF-8 TXT 文件。');
    const text = await file.text();
    if (text.includes('\uFFFD')) throw new Error('文件编码无法正确识别，请另存为 UTF-8。');
    if (text.length > 16000) throw new Error('对话超过 16,000 字符，请拆分。');
    if (pending || !replaceAllowed()) return;
    $('dialogue').value = text; $('dialogue').oninput(); toast('已导入文本，请检查角色标签');
  } catch (error) { toast(error.message); }
  event.target.value = '';
};
document.querySelectorAll('.sample-chip').forEach(button => { button.onclick = () => {
  const sample = samples.find(s => s.id === button.dataset.sample);
  if (!sample) { toast('样例加载失败，请刷新页面'); return; }
  if (!replaceAllowed()) return;
  $('dialogue').value = sample.text; updateInput();
  document.querySelectorAll('.sample-chip').forEach(b => b.classList.toggle('active', b === button));
  $('sample-expectation').textContent = `自制样例 · 预期结果（非模型实测）：${sample.expected}`; $('sample-expectation').hidden = false;
}; });
$('analyze-btn').onclick = async () => {
  if (pending) return;
  try { checkText(); } catch (error) { $('input-message').textContent = error.message; return; }
  if (!replaceAllowed()) return;
  clearReport();
  if (!ready()) { status('未配置模型', 'error'); showPane('error-report'); $('error-title').textContent = '先连接你的模型'; $('error-detail').textContent = '请在模型设置中填写 API Key、Base URL 和 Model Name。未配置时不会生成质检结论。'; return; }
  if (!$('dialogue').value.trim()) { $('input-message').textContent = '请先输入一段对话，或选择上方样例。'; $('dialogue').focus(); return; }
  setPending(true); showPane('loading-report'); status('分析中 · 语境理解与证据核验'); $('input-message').textContent = '';
  analysisController = new AbortController(); const started = Date.now(); $('elapsed').textContent = '已用 0 秒';
  elapsedTimer = setInterval(() => { $('elapsed').textContent = `已用 ${Math.floor((Date.now()-started)/1000)} 秒 · 等待模型响应`; }, 1000);
  try {
    report = await api('/api/analyze', { text: $('dialogue').value, config, scenario:scenario() }, 70000, analysisController.signal);
    report.scenarioLabel = scenarioLabel(); dirty = true;
    renderReport(report); showPane('report-content'); status('分析成功 · 已完成格式与原文证据校验', 'success'); $('export-btn').disabled = false;
  } catch (error) { if (analysisController?.signal.aborted) { clearReport(); status('分析已取消 · 可修改文本或重新分析'); } else { report = null; showPane('error-report'); status(error.code === 'MODEL_NOT_CONFIGURED' ? '未配置模型' : '分析失败', 'error'); $('error-title').textContent = '本次分析未完成'; $('error-detail').textContent = error.message; } }
  finally { clearInterval(elapsedTimer); analysisController = null; setPending(false); }
};
$('cancel-btn').onclick = () => analysisController?.abort();
function renderReport(data) {
  selectedEvidence = null;
  $('source-tabs').hidden = false; document.querySelector('.workspace').classList.add('reviewing');
  $('source-location').textContent = data.dimensions.some(d => d.findings.length) ? '点击右侧风险证据，定位对应销售发言。' : '本次未发现可定位的风险点，可逐条复核分析原文。';
  $('return-to-risk').hidden = true; renderSource(); setSourceView('review');
  const target = $('report-content'); target.replaceChildren();
  const summary = el('div', 'report-summary');
  const overall = el('div', 'overall-status'); overall.append(el('span', '', 'AI 总体风险'), el('strong', 'badge ' + data.overall, OVERALL[data.overall]));
  const counts = el('div', 'summary-counts');
  for (const state of ['high', 'remind', 'pass']) counts.append(el('span', '', `${LABEL[state]} ${data.dimensions.filter(d => d.status === state).length}`));
  summary.append(overall, counts); target.append(summary);
  target.append(el('div', 'report-meta', `${data.model} · ${(data.durationMs / 1000).toFixed(1)} 秒 · ${new Date(data.createdAt).toLocaleString('zh-CN')}`));
  target.append(el('p', 'coverage-note', `${data.overall === 'pass' ? '本片段未发现明确风险。' : ''}${data.coverage || ''}`));
  target.append(el('p', 'report-meta', `${data.scenarioLabel} · 对话日期 ${data.scenario?.dialogueDate || '未知'} · 人工复核单独记录，不覆盖 AI 结论`));
  const policies = el('details', 'policy-details'); policies.append(el('summary', '', '本次规则范围与依据'));
  for (const r of data.policy?.active || []) policies.append(policyLink(r, '检查参考'));
  for (const r of data.policy?.upcoming || []) policies.append(policyLink(r, '对话日期尚未生效，不作违规依据'));
  target.append(policies);
  const progress = el('p', 'report-meta'); progress.id = 'review-progress'; target.append(progress);
  if (data.warnings.length) target.append(el('div', 'report-warning', data.warnings.join('\n')));
  const wrap = el('div', 'matrix-scroll'); const table = el('table', 'review-matrix');
  table.append(el('caption', 'sr-only', '五个质检维度的结果，选择维度查看详细依据'));
  const head = el('thead'); const headRow = el('tr');
  for (const title of ['质检维度', '结果', '风险项', '判断摘要']) { const cell = el('th', '', title); cell.scope = 'col'; headRow.append(cell); }
  head.append(headRow); table.append(head); const rows = el('tbody');
  for (const d of data.dimensions) {
    const row = el('tr', 'matrix-row'); row.dataset.dimension = d.id;
    const nameCell = el('th'); nameCell.scope = 'row';
    const select = el('button', 'dimension-select', d.name); select.type = 'button'; select.setAttribute('aria-label', `查看${d.name}详情`); select.setAttribute('aria-controls', 'dimension-detail');
    nameCell.append(select);
    const result = el('td'); result.append(el('span', 'badge ' + d.status, LABEL[d.status]));
    const count = el('td', 'matrix-count', String(d.findings.length));
    const reason = el('td', 'matrix-reason'); const preview = el('span', '', d.reason); preview.title = d.reason; reason.append(preview);
    row.append(nameCell, result, count, reason); row.onclick = () => selectDimension(d.id);
    rows.append(row);
  }
  table.append(rows); wrap.append(table); target.append(wrap);
  const detail = el('section', 'dimension-detail'); detail.id = 'dimension-detail'; detail.setAttribute('aria-label', '当前质检维度详情'); target.append(detail);
  target.append(el('div', 'report-disclaimer', '“通过”仅指当前片段未发现风险。信息不足时需人工复核，自动校验不替代合规专业判断。'));
  selectDimension(data.dimensions.find(d => d.status === 'high')?.id || data.dimensions.find(d => d.status === 'remind')?.id || data.dimensions[0].id);
  updateReviewProgress();
}
function policyLink(r, prefix) {
  const p = el('p', 'policy-reference'); const a = el('a', '', `${r.id} · ${r.source}`); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  p.append(document.createTextNode(`${prefix}：`), a, document.createTextNode(` · 生效 ${r.effective}`)); return p;
}
function updateReviewProgress() {
  const targets = report.dimensions.flatMap(d => d.findings.length ? d.findings : [d]);
  $('review-progress').textContent = `人工复核：已记录 ${targets.filter(t=>t.review).length} / ${targets.length} 项；待补材料 ${targets.filter(t=>t.review?.decision==='materials').length} 项。记录仅本页有效，请导出保存。`;
}
function reviewEditor(target, label, empty = false) {
  const box = el('div', 'review-editor'); const select = el('select'); select.setAttribute('aria-label', `${label}复核结论`);
  for (const [value, text] of Object.entries(REVIEW_LABELS)) { if (empty && ['confirmed','false_positive'].includes(value) || !empty && value === 'checked') continue; const opt = el('option','',text); opt.value=value; select.append(opt); }
  select.value = target.review?.decision || 'pending';
  const note = el('textarea'); note.rows=2; note.maxLength=600; note.placeholder='填写复核理由或需补充的材料（请勿填写个人敏感信息）'; note.setAttribute('aria-label',`${label}复核备注`); note.value=target.review?.note || '';
  const save = el('button','button secondary','保存复核'); save.type='button';
  const saved = el('p','helper',target.review ? `${REVIEW_LABELS[target.review.decision]} · ${new Date(target.review.at).toLocaleString('zh-CN')}` : '尚未复核；AI 结论保持不变。'); saved.setAttribute('role','status');
  note.oninput = select.onchange = () => { reviewDrafts.add(target); reviewDraftDirty=true; saved.textContent='有未保存修改，请保存复核后再切换维度。'; };
  save.onclick = () => { try { const r=recordReview(target,select.value,note.value); dirty=true; reviewDrafts.delete(target); reviewDraftDirty=reviewDrafts.size>0; saved.textContent=`${REVIEW_LABELS[r.decision]} · ${new Date(r.at).toLocaleString('zh-CN')} · 已保存 ${target.reviewHistory.length} 次记录`; updateReviewProgress(); } catch(error) { saved.textContent=error.message; } };
  box.append(el('strong','','人工复核'),select,note,save,saved); return box;
}
function selectDimension(id) {
  if (reviewDraftDirty && !window.confirm('当前复核备注尚未保存，切换会丢失草稿。是否继续？')) return;
  reviewDraftDirty=false; reviewDrafts.clear();
  const d = report?.dimensions.find(item => item.id === id); if (!d) return;
  selectedEvidence = null; $('return-to-risk').hidden = true;
  renderSource(); setSourceView('review');
  $('source-location').textContent = d.findings.length ? '点击风险详情中的证据，定位原文。' : '当前维度无可定位证据，可结合完整对话复核。';
  document.querySelectorAll('.matrix-row').forEach(row => {
    const selected = row.dataset.dimension === id; row.classList.toggle('is-selected', selected);
    row.querySelector('button').setAttribute('aria-current', String(selected));
  });
  const body = $('dimension-detail'); body.replaceChildren();
  const header = el('div', 'detail-heading'); const heading = el('div');
  heading.append(el('span', 'detail-kicker', '维度详情'), el('h3', '', d.name));
  header.append(heading, el('span', 'badge ' + d.status, LABEL[d.status])); body.append(header);
  body.append(el('p', 'dimension-reason', d.reason));
  if (d.needsReview) body.append(el('div', 'review-notice', '需要人工复核：请补充上下文或相关材料后确认。'));
  if (!d.findings.length) body.append(el('p', 'no-findings', d.status === 'pass' ? '当前维度未发现风险点。' : '当前没有足够的销售原文证据，不作明确违规判断。'));
  if (!d.findings.length) body.append(reviewEditor(d, d.name, true));
  for (const [index, f] of d.findings.entries()) {
      const item = el('div', 'finding ' + (f.severity || d.status));
      const evidence = el('button', 'evidence evidence-jump'); evidence.type = 'button';
      evidence.setAttribute('aria-label', `定位 ${f.turnId} 销售原文：${f.quote}`); evidence.setAttribute('aria-controls', 'source-reader'); evidence.setAttribute('aria-pressed', 'false');
      evidence.append(el('span', 'evidence-quote', f.quote), el('span', 'evidence-action', `定位 ${f.turnId} 原文 ↗`));
      evidence.onclick = () => locateEvidence(f, evidence);
      item.append(el('div', 'finding-label', `证据 ${index + 1} · ${f.turnId} 销售${f.needsReview ? ' · 需要人工复核' : ''}`), evidence, el('p', 'finding-reason', f.reason));
      const suggestion = el('div', 'suggestion'); suggestion.append(el('span', '', '建议修改 / 后续动作'), document.createTextNode(f.suggestion)); item.append(suggestion); body.append(item);
      item.prepend(el('span','badge '+(f.severity || d.status),LABEL[f.severity || d.status]));
      const copy=el('button','text-button','复制修改建议'); copy.type='button'; copy.onclick=async()=>{ try { await navigator.clipboard.writeText(f.suggestion); toast('修改建议已复制'); } catch { toast('复制失败，请选中建议文本手动复制'); } }; item.append(copy);
      for (const r of f.references || []) item.append(policyLink(r,'参考依据'));
      if (!f.references?.length) item.append(el('p','helper','未关联具体法规条款，仅为表达风险提示。'));
      item.append(reviewEditor(f, `${d.name}第${index+1}项`));
  }
}
$('export-btn').onclick = () => {
  if (!report) return;
  if (reviewDraftDirty) { toast('请先保存复核备注，再导出报告。'); return; }
  const blob = new Blob(['\uFEFF' + formatReport(report)], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = el('a'); a.href = url; a.download = `质检报告_${new Date().toISOString().replace(/[:.]/g, '-')}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); dirty=false; toast('已发起下载，包含复核记录，不包含模型密钥');
};
async function init() {
  updateInput();
  try {
    const [infoResponse, sampleResponse] = await Promise.all([fetch('/api/info'), fetch('/api/samples')]);
    if (!infoResponse.ok || !sampleResponse.ok) throw new Error();
    const info = await infoResponse.json(); samples = await sampleResponse.json(); $('env-option').hidden = !info.envConfigured;
  } catch { $('input-message').textContent = '无法读取本地配置和样例，请确认服务已启动后刷新。'; }
}
init();
