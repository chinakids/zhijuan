// 数据层冒烟：writingInsights 纯函数 × 织卷smoke 真实数据（只读，零副作用）
// 用法：cd ~/Desktop/织卷 && node scripts/writing-insights-datasmoke.mjs
// （仓库标准模式：esbuild bundle shared 纯函数 → node 直跑；与本脚本头注同规格）
import { readFileSync, readdirSync, statSync } from 'fs'
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
