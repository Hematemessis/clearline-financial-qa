// 人工核验的有限规则集；不是全行业法规数据库。日期以行为发生日筛选。
export const SCENARIO_OPTIONS = {
  product: { unknown: '未确定产品', securities: '证券业务', fund: '公募基金', privatefund: '私募基金', other: '其他金融产品（通用初筛）' },
  channel: { unknown: '渠道不明', online: '网络沟通 / 营销', offline: '线下沟通' },
  stage: { unknown: '阶段不明', introduction: '产品介绍', recommendation: '主动推荐', purchase: '客户申请购买', aftersale: '售后服务' }
};
const suitability = 'https://www.csrc.gov.cn/csrc/c106256/c1653849/content.shtml';
const fund = 'https://www.csrc.gov.cn/csrc/c106256/c1653806/content.shtml';
const marketing = 'https://www.gov.cn/zhengce/zhengceku/202604/content_7066927.htm';
export const POLICY_RULES = [
  { id:'SEC-01', dimension:'returns', title:'不确定事项不得作确定性判断', source:'证券期货投资者适当性管理办法 第22条', url:suitability, effective:'2020-10-30', products:['securities','fund','privatefund'], requirement:'不得向投资者就不确定事项给出确定性判断，或使其误认为具有确定性。否定、引用反例不能直接判为承诺。' },
  { id:'SEC-02', dimension:'suitability', title:'主动推介与自主购买的适当性边界', source:'证券期货投资者适当性管理办法 第19、22条', url:suitability, effective:'2020-10-30', products:['securities','fund','privatefund'], requirement:'区分主动推介超风险产品与客户主动坚持购买。后者须核实非最低风险类别、特别书面警示等条件，具体产品可能更严格；不能仅因等级不匹配直接判定违规，不能把此程序当作通用豁免。缺材料需复核。' },
  { id:'FUND-01', dimension:'returns', title:'收益预测、保本和限损承诺', source:'公开募集证券投资基金销售机构监督管理办法 第24条', url:fund, effective:'2020-10-01', products:['fund'], requirement:'识别违规承诺收益、本金不受损失、限定损失、预测基金业绩或宣传预期收益率。区分历史业绩与未来预测。' },
  { id:'FUND-02', dimension:'trading', title:'诱导短期或频繁申赎', source:'公开募集证券投资基金销售机构监督管理办法 第17条', url:fund, effective:'2020-10-01', products:['fund'], requirement:'识别销售诱导投资人短期或频繁申赎的表达；客户自主调整持仓或一般说明赎回流程不等于诱导。' },
  { id:'FUND-03', dimension:'disclosure', title:'销售主体、赠礼抽奖与绑定销售', source:'公开募集证券投资基金销售机构监督管理办法 第24条', url:fund, effective:'2020-10-01', products:['fund'], requirement:'检查模糊实际销售主体、抽奖回扣或送实物等方式销售基金，以及绑定性销售安排。材料未提及主体不等于故意隐瞒，缺证据需复核。' },
  { id:'PRIVATE-01', dimension:'disclosure', title:'私募公开推介边界', source:'公开募集证券投资基金销售机构监督管理办法 第45条', url:fund, effective:'2020-10-01', products:['privatefund'], requirement:'基金销售机构不得公开或变相公开宣传推介私募基金；需核实对象是否特定及渠道范围，不能把所有一对一沟通判为公开营销。' },
  { id:'NET-01', dimension:'disclosure', title:'网络营销的误导宣传', source:'金融产品网络营销管理办法 第8、10条', url:marketing, effective:'2026-09-30', products:['securities','fund','privatefund','other'], channel:'online', requirement:'检查片面业绩、虚假监管背书、未经核实数据、诱导性用语。低风险等关键词不直接等于违规。数据真实性、合同一致性、展示醒目程度需外部材料验证。' },
  { id:'NET-02', dimension:'conduct', title:'拒收后继续营销', source:'金融产品网络营销管理办法 第13条', url:marketing, effective:'2026-09-30', products:['securities','fund','privatefund','other'], channel:'online', requirement:'拒收或退订后不得以同样方式再次发送营销信息或拨打营销电话。须核实拒收、后续触达和方式；一般售后服务不等于营销。' },
  { id:'DATA-01', dimension:'conduct', title:'个人信息最小必要与敏感信息保护', source:'个人信息保护法 第6、13、21、28—30条', url:'https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm', effective:'2021-11-01', products:['unknown','securities','fund','privatefund','other'], requirement:'判断不必要索取或传播个人信息；区分依法核验、委托处理、其他提供关系及合法处理依据，不能一律以未提到同意判违规。客户主动提供信息不能直接归责销售。' }
];
export function normalizeScenario(input = {}, today = new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Shanghai' })) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('审核场景格式错误。');
  const result = {};
  for (const [key, options] of Object.entries(SCENARIO_OPTIONS)) {
    const value = input[key] ?? 'unknown';
    if (!Object.hasOwn(options, value)) throw new Error('审核场景选项不正确。');
    result[key] = value;
  }
  const date = input.dialogueDate || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date > today) throw new Error('对话日期必须是有效日期，且不能晚于今天。');
  return { ...result, dialogueDate:date };
}
export function rulesFor(scenario) {
  const matches = POLICY_RULES.filter(r => r.products.includes(scenario.product) && (!r.channel || r.channel === scenario.channel));
  return { active:matches.filter(r => r.effective <= scenario.dialogueDate), upcoming:matches.filter(r => r.effective > scenario.dialogueDate) };
}
