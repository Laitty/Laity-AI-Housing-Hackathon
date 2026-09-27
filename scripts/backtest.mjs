import fs from 'node:fs';
import { scoreSite } from '../server/score.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/backtest.mjs INPUT.jsonl OUTPUT.md');
  process.exit(2);
}

const rows = fs.readFileSync(input, 'utf8').trim().split('\n').map((line) => {
  const row = JSON.parse(line);
  return { ...row, score: scoreSite(row) };
});
const issued = rows.filter((row) => row.cohort === 'issued_two_unit_permit');
const sample = rows.filter((row) => row.cohort === 'city_random_sample');
const scorable = (rows) => rows.filter((row) => row.score.displayRange);
const count = (rows, status) => rows.filter((row) => row.score.status === status).length;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const percent = (number, denominator) => `${(100 * number / denominator).toFixed(1)}%`;
const statuses = [
  'Preliminary screening range',
  'Minimum lot size review required',
  'Use is not listed by-right; review path before a score',
  'Base zoning review required before a score',
];
const statusTable = statuses.map((status) =>
  `| ${status} | ${count(issued, status)} / ${issued.length} | ${count(sample, status)} / ${sample.length} |`).join('\n');
const cases = issued.sort((a, b) => a.pin.localeCompare(b.pin)).map((row) => {
  const s = row.score;
  const zoning = row.districts.map((d) => `${d.code} ${d.parcelShare.toFixed(1)}%`).join(', ') || 'No mapped district';
  const finding = s.status === 'Minimum lot size review required' ? 'Mapped area below base minimum'
    : !s.displayRange ? 'Use path or district split needs review'
      : 'Base screen passed';
  return `| ${row.pin} | ${row.permits.map((p) => p.issue_date).join(', ')} | ${zoning} | ${s.displayRange ? `${s.minimum}${s.maximum === s.minimum ? '' : `–${s.maximum}`}` : 'Withheld'} | ${finding} |`;
}).join('\n');
const issuedScorable = scorable(issued);
const sampleScorable = scorable(sample);
const issuedZoningReview = issued.length - issuedScorable.length;
const hazardHits = (set) => set.filter((row) =>
  row.flood.share >= 1 || row.slope.share >= 1 || row.undermined.share >= 1).length;

const report = `# Track 1 Development Ease Score · 原始数据回测

**回测日期：2026-09-27。** 场景固定为“在单个地块新建一栋两户住宅”。这是对现有规则型评分原型的首次外部数据核验，**不是获批概率或预测准确率**。

## 评分体系

实际运行的代码为 [server/score.js](../server/score.js)。100 分由分区/规则 45、地块条件 25、环境/地形 30 构成。分区用途、面积门槛、地块面积与紧凑度、1% 洪水区、≥25% 坡地和采空区逐项计分；缺失项显示分数范围。详细阈值见 [README](../README.md#scoring-model)。历史保护、现有建筑及水污容量进入复核提示，不混进分数。

回测发现：当前已签发的两户住宅许可中，有地块低于地图上单块地的基础面积门槛。**低于门槛现在扣除该项 15 分并强制提示核验，而不再隐藏整个分数**；法定 zoning lot、既有合法地块、例外或跨地块方案需个案核实。当前分区用途无法可靠判定时仍隐藏标题分数。

## 样本与方法

- 地块边界：2026-09 Allegheny County Shapefile；分区、FEMA 2026 市府副本、陡坡与采空区：已下载的原始图层。所有地块与多边形在 EPSG:2272 下计算面积相交；不是仅用中心点匹配。
- 正例：WPRDC PLI 许可中，\`status\` 为 Issued/Completed 且有签发日期、\`permit_type\` 为 BUILDING/BDA、\`work_type\` 为 NEW CONSTRUCTION、\`commercial_or_residential\` 为 Residential，且描述明确含两户住宅/duplex 的 **${issued.length} 个不同 parcel ID**。排除商住混合和“两栋单户组成的 cluster”。
- 对照：在匹兹堡 101–132 ward 对应的 **142,600** 个县级地块中，固定随机种子抽取 **${sample.length}** 个。它们是背景样本，**不是被拒绝的申请**。
- 使用**当前**地图复看 2019–2025 年签发的许可。这会产生时间错配；本回测只能发现明显不一致，不能重建当年审批依据。

## 结果

| 模型输出 | 已签发两户住宅许可 | 随机市内地块 |
|---|---:|---:|
${statusTable}

已签发样本中，**${issuedScorable.length}/${issued.length}（${percent(issuedScorable.length, issued.length)}）**可显示条件性分数；其中 **${count(issued, 'Minimum lot size review required')} 个**有面积门槛提示。**${issuedZoningReview} 个**因当前分区用途或跨区边界需人工核验。随机背景样本可显示分数的比例为 **${sampleScorable.length}/${sample.length}（${percent(sampleScorable.length, sample.length)}）**。

可评分样本的分数下界中位数：已签发许可 **${median(issuedScorable.map((row) => row.score.minimum))}**，随机背景 **${median(sampleScorable.map((row) => row.score.minimum))}**。这表明当前分数**没有证明能预测许可发生**；许可地块由开发者主动选择，分数也没有纳入市场、权属、融资和完整审批路径。此比较只用作诊断，不作为模型准确率。

在已签发样本中，**${hazardHits(issued)}/${issued.length}** 与所测洪水、陡坡或采空区图层有 ≥1% 重叠；背景样本为 **${hazardHits(sample)}/${sample.length}**。该差异不能单独证明环境权重正确，因为申请选择和年代均不同。

## 逐案核验

| Parcel ID | 签发日期 | 当前分区图层 | 分数 | 系统提示 |
|---|---|---|---:|---|
${cases}

### 从分歧学到什么

1. **面积门槛不可当作绝对否决**：${count(issued, 'Minimum lot size review required')} 个已签发案例的单 parcel 映射面积低于基础门槛。必须继续查法定 zoning lot、非合规既有地块、例外及审批文件。系统保留扣分和复核提示。
2. **历史许可不能用当前分区判决**：部分许可地块当前显示 R1D 或跨多个分区。需要当年分区图、批准的例外/变更和完整许可证档案，才能判定模型是否漏掉法律路径。
3. **环境命中不是工程结论**：与图层相交只触发尽调。没有地块级水污容量、土质勘察和真实施工成本数据，不能把分数解释为工期或成本预测。

## 回测结论与下一轮验证

这版原型能复现来源图层并解释每项得分，但目前只能称为**资料驱动的初筛分**。若要证明排序质量，需取得同一时期的**申请日期、拒绝/撤回、审批条件、批准的 variance 和施工结果**，或让规划人员盲评 20–30 个覆盖不同障碍的地块。之后用“关键障碍漏报率、许可路径判断、专家成对排序一致率”和数据缺失时的处理来调权重。本次没有用 16 个正例去拟合权重，以免过拟合。

## 复现

\`\`\`bash
python3 -m pip install pyshp shapely pyproj
python3 scripts/build_backtest_features.py --data-dir ../data/raw --output ../data/derived/backtest_features_2026-09-27.jsonl
node scripts/backtest.mjs ../data/derived/backtest_features_2026-09-27.jsonl analysis/backtest-2026-09-27.md
node --test server/*.test.js
\`\`\`

原始下载地址、校验和与时间位于本地 \`../data/raw/manifest.json\`；大型原始文件不进入 GitHub。
`;
fs.mkdirSync(new URL('../analysis/', import.meta.url), { recursive: true });
fs.writeFileSync(output, report);
console.log(`Wrote ${output}`);
