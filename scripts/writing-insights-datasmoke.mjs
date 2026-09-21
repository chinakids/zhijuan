// 数据层冒烟：writingInsights 纯函数 × 织卷smoke 真实数据（段 A 只读零副作用；段 B 增量 4b 执行层=隔离环境真盘运行）
// 用法：cd ~/Desktop/织卷 && node scripts/writing-insights-datasmoke.mjs
// （仓库标准模式：esbuild bundle → node 直跑；段 B 用 electron-stub+临时 userData/工作区/项目库，零污染真实库）
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync, rmSync, cpSync } from 'fs'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { build as esbuild } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const out = '/tmp/zj-writinginsights-datasmoke.mjs'
await esbuild({
  stdin: {
    contents: `export * from ${JSON.stringify(resolve(root, 'src/shared/writingInsights.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  external: ['node:*'],
  logLevel: 'warning'
})
const {
  extractVersionRules,
  summarizeProposals,
  syntaxStats,
  buildSignals,
  draftSkillFromStats,
  reportFromStats,
  shouldRunInsights
} = await import(pathToFileURL(out).href)

const PJ = process.env.ZJ_PJ || '/Users/USER/Documents/织卷项目库/织卷smoke'

function listFiles(dir) {
  if (!dir) return []
  let out = []
  for (const n of readdirSync(dir)) {
    const f = join(dir, n)
    const st = statSync(f)
    if (st.isDirectory()) out = out.concat(listFiles(f))
    else out.push(f)
  }
  return out
}

console.log('=== 段 A · 4a 纯函数 × 织卷smoke 真实数据（只读） ===')
// 1) proposals
const propDir = join(PJ, '.zhijuan/proposals')
const proposals = (readdirSync(propDir).filter((f) => f.endsWith('.json'))).map((f) =>
  JSON.parse(readFileSync(join(propDir, f), 'utf-8'))
)
const ps = summarizeProposals(proposals)
console.log('PROPOSALS total=', ps.total, 'byStatus=', JSON.stringify(ps.byStatus))
console.log('  bySource=', JSON.stringify(ps.bySource.map((s) => `${s.source}:${s.total}(acc${s.acceptRate})`)))

// 2) 正文 chapters
const novels = listFiles(join(PJ, '正文')).filter((f) => f.endsWith('.md'))
const chapters = novels.map((f) => ({ file: f.replace(PJ + '/', ''), raw: readFileSync(f, 'utf-8') }))
const syn = syntaxStats(chapters, { topPhrases: 5 })
console.log('SYNTAX chars=', syn.chars, 'sent=', syn.sentences.count, 'avg=', syn.sentences.avg,
  'paras=', syn.paragraphs.count, 'top=', JSON.stringify(syn.topPhrases.map((p) => p.phrase)))

// 3) version diffs：history 快照（写盘前旧版）→ 当前正文 = 一组真实 original/final
const histDir = join(PJ, '.zhijuan/history/正文')
const changes = []
for (const snapDir of readdirSync(histDir)) {
  const dir = join(histDir, snapDir)
  const snapFiles = readdirSync(dir).filter((f) => f.endsWith('.md'))
  if (!snapFiles.length) continue
  const snap = readFileSync(join(dir, snapFiles[0]), 'utf-8')
  const novel = novels.find((f) => f.includes(snapDir))
  if (!novel) continue
  changes.push({ file: '正文/' + snapDir + '.md', before: snap, after: readFileSync(novel, 'utf-8') })
}
const rules = extractVersionRules(changes)
console.log('RULES=', rules.length, JSON.stringify(rules.map((r) => `${r.kind}:${r.subject}x${r.count}`)))

const signals = buildSignals({ changes, proposals, chapters })
const draft = draftSkillFromStats(signals, { generatedAt: new Date() })
const report = reportFromStats(signals, { generatedAt: new Date() })
console.log('DRAFT len=', draft.length, 'has disabled:', draft.includes('disabled: true'))
console.log('REPORT has 3 sections:', report.includes('## Executive summary') && report.includes('## Key findings') && report.includes('## Recommendations'))
console.log('GATE=', shouldRunInsights({ enabled: true, now: Date.now(), hasAnySignal: signals.versionRules.length + proposals.length + (syn.chars > 0 ? 1 : 0) > 0 }))
console.log('---DRAFT(head)---')
console.log(draft.slice(0, 900))
console.log('---REPORT(head)---')
console.log(report.slice(0, 700))

// =====================================================================
console.log('\n=== 段 B · 4b 执行层（runWritingInsights 真盘运行，隔离环境） ===')
const UD = '/tmp/zj-wi-exec'
const ws = UD + '/ws'
const lib = UD + '/lib'
rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
// 设置：开关开 + workspace 临时 + libraryRoot 临时（readSettings 在模块加载时读盘 → 先写盘）
writeFileSync(UD + '/zhijuan-settings.json', JSON.stringify({
  workspace: ws,
  libraryRoot: lib,
  writingInsightsEnabled: true
}))
process.env.ZJ_USERDATA = UD
// 复制真实织卷smoke 项目（数据=真盘内容；隔离库零污染，只有 .zhijuan/insights-state.json 会在拷贝上写）
cpSync(PJ, join(lib, '织卷smoke'), { recursive: true })

const out2 = '/tmp/zj-wi-exec-bundle.mjs'
await esbuild({
  stdin: {
    contents: [
      `export { runWritingInsights, gatherSignals, readInsightsState, draftsDir, insightDateStamp, insightsStateFile } from ${JSON.stringify(resolve(root, 'src/main/writingInsights.ts'))};`,
      `export { listSkills } from ${JSON.stringify(resolve(root, 'src/main/skills.ts'))};`,
      `export { setSettings } from ${JSON.stringify(resolve(root, 'src/main/settings.ts'))};`
    ].join('\n'),
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out2,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const m = await import(pathToFileURL(out2).href)

let pass = 0
const fail = (name) => {
  console.error('  ✗ 断言失败: ' + name)
  process.exit(1)
}
const assert = (name, cond) => {
  if (!cond) fail(name)
  pass++
  console.log('  ✓ ' + name)
}

const drafts = m.draftsDir()
assert('draftsDir = <工作区>/skills/_drafts', drafts === join(ws, 'skills/_drafts'))

// 1) 首跑：开关开 + 无状态 → ok + 草稿/报告落盘
const r1 = m.runWritingInsights('织卷smoke')
assert('首跑 ok:true', r1.ok === true)
assert('草稿落盘 _drafts/', existsSync(r1.draftFile) && r1.draftFile.startsWith(drafts))
assert('报告落盘 _drafts/', existsSync(r1.reportFile))
assert('草稿含 front matter/disabled:true/正文标题', (() => {
  const t = readFileSync(r1.draftFile, 'utf-8')
  return t.includes('name: writing-habits') && t.includes('disabled: true') && t.includes('## 我的写作习惯')
})())
assert('报告三段结构', (() => {
  const t = readFileSync(r1.reportFile, 'utf-8')
  return t.includes('## Executive summary') && t.includes('## Key findings') && t.includes('## Recommendations')
})())
const stamp = m.insightDateStamp(new Date())
assert('文件名日期口径 YYYY-MM-DD', r1.draftFile.endsWith(`${stamp}-写作习惯.md`))
assert('状态写回 .zhijuan/insights-state.json', (() => {
  const st = m.readInsightsState(join(lib, '织卷smoke'))
  return st && typeof st.lastRunAt === 'number' && st.lastDraft === `${stamp}-写作习惯.md`
})())
assert('信号采集==段A口径（syntax chars 一致）', (() => {
  const sig = m.gatherSignals('织卷smoke')
  return sig.syntax.chars === syn.chars
})())

// 2) 二次跑：7 天门控跳过（recent）
const r2 = m.runWritingInsights('织卷smoke')
assert('二次跑门控 recent', r2.ok === false && r2.reason === 'recent')
assert('二次跑无新产出（目录仍 2 文件）', readdirSync(drafts).length === 2)

// 3) _drafts/ 不参与 listSkills（D-L-6：扫描器只认 skills/<名>/SKILL.md）
assert('listSkills 不含草稿（_drafts 被忽略）', (() => {
  const sk = m.listSkills()
  return sk.length === 0
})())

// 4) disabled 门控（开关关 → 不跑不产出）
m.setSettings({ writingInsightsEnabled: false })
const r3 = m.runWritingInsights('织卷smoke')
assert('disabled 门控 reason=disabled', r3.ok === false && r3.reason === 'disabled')
assert('disabled 后不新增产出', readdirSync(drafts).length === 2)

console.log(`\n=== 段 B 结果: ${pass} 断言全过 ===`)
console.log('--- 草稿全文（证据） ---')
console.log(readFileSync(r1.draftFile, 'utf-8'))
process.exit(0)
