// ===== 织卷 · 写作习惯学习（信号纯函数层，增量 4a，2026-09-22 智能层） =====
// 设计基线：docs/写作习惯学习-产品规划-2026-09-21.md（§3 决策 D-L / §4 信号清单 / §7 验收 / §8 增量 4a）。
// 调研依据（本轮真实抓取，来源记档）：
//   - ProWritingAid 官方 features 页（prowritingaid.com/features，2026-09-22 CDP 9224 实抓）：
//     「Sentence Length = See how your sentence lengths vary and create more rhythm, variety, and flow
//       throughout your writing」「Sticky Sentences = tighten your prose」「Pacing = balance the pace」——
//     句长/节奏/精简是业界公认的写作习惯报告面，正对「用词句法聚合」信号。
//   - writing-style-skill（jzOcb ★270，21:00 轮存档 /tmp/zj-learn/wss-readme.md）：从 original/final
//     两版 diff 提取规则=自动学习闭环；P0/P1/P2 置信度分档=草稿「证据强度」标注的映射。
// 本文件=纯函数层：零 IO、零模型、零依赖（词表复用 wordfreq、类型复用 shared/types）。
// 读盘执行 / 门控 / _drafts 产出在 main/writingInsights.ts（增量 4b）；本层只做「给定数据→信号→草稿/报告」。
import { visibleBodyOf, countPhraseInText, overuseCheck, normalizeOveruseDict, BUILTIN_OVERUSE } from './wordfreq'
import type { Proposal } from './types'

// =====================================================================
// 一、正文版本 diff 规则提取（信号源①：.zhijuan/history/正文/<章>/(快照序列)）
// 快照语义（main/history.ts writeSnapshot）：写盘前自动存旧版 → 快照序列 v1,v2,v3（时间序）
// = 初版、第一次修改后、第二次修改后……相邻对 (vi, vi+1) 恰好构成一次修改的 before/after
// （= jzOcb original/final 数据模型，零新埋点）。
// =====================================================================

/** 一次正文版本改动（before=写盘前旧版，after=写盘后新版；均含约定头原样） */
export interface VersionChange {
  /** 相对项目根路径；只收 正文/ 前缀（脱敏口径=只看正文本体，设定/大纲改动不入习惯信号） */
  file: string
  before: string
  after: string
}

/** 规则佐证示例对（各 ≤80 字符，截断加 …） */
export interface DiffExample {
  before: string
  after: string
}

export interface VersionRule {
  kind: 'removed-phrase' | 'split-sentence' | 'merged-sentence' | 'shortened' | 'lengthened'
  /** 规则主题：removed-phrase=被删短语原文；其余=「长句」「段落」等通用化表述 */
  subject: string
  /** 作者倾向方向：prefers=偏好做某事；avoids=回避某写法 */
  direction: 'prefers' | 'avoids'
  /** 观察次数（证据强度：强=≥5 / 中=2–4 / 弱=1） */
  count: number
  /** 出处（报告用：哪些章出现、各几次） */
  files: { file: string; count: number }[]
  /** 佐证示例（≤ opts.exampleLimit 条；每条 before/after ≤80 字符） */
  examples: DiffExample[]
}

/** 中文句子切分：按 。！？…（含连用）切，句首引号/空格剥掉；空句过滤。
 *  零分词器、零依赖——与 wordfreq 免分词 n-gram 同精神；「句长」统计口级=可见字符数。 */
export function splitSentences(text: string): string[] {
  return String(text)
    .split(/[。！？…]+/)
    .map((s) => s.replace(/^[“”"'"「」『』\s]+/, '').trim())
    .filter((s) => s.length > 0)
}

/** 行级 LCS diff → 修改块列表（removed=被删行，added=新增行）。O(n*m) DP，正文行数 <500 无压力。 */
export function diffHunks(beforeText: string, afterText: string): { removed: string[]; added: string[] }[] {
  const a = beforeText.split('\n')
  const b = afterText.split('\n')
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const hunks: { removed: string[]; added: string[] }[] = []
  let cur: { removed: string[]; added: string[] } | null = null
  let i = 0
  let j = 0
  const flush = () => {
    cur = null
  }
  const addRemove = (line: string) => {
    if (!cur) {
      cur = { removed: [], added: [] }
      hunks.push(cur)
    }
    cur.removed.push(line)
  }
  const addInsert = (line: string) => {
    if (!cur) {
      cur = { removed: [], added: [] }
      hunks.push(cur)
    }
    cur.added.push(line)
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush()
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      addRemove(a[i])
      i++
    } else {
      addInsert(b[j])
      j++
    }
  }
  while (i < n) {
    addRemove(a[i])
    i++
  }
  while (j < m) {
    addInsert(b[j])
    j++
  }
  return hunks.filter((h) => h.removed.length > 0 || h.added.length > 0)
}

const CUT80 = (s: string) => (s.length > 80 ? s.slice(0, 80) + '…' : s)

/** 单个 hunk → 版本规则命中（同一个 hunk 可命中多条不同规则，互相独立；同规则每 hunk 至多记 1 次）。
 *  判定保守（宁缺勿错报）：只收「结构可辨」的变化，不做语义推断。 */
function analyzeHunk(removed: string[], added: string[], dict: string[]): VersionRule[] {
  const rem = removed.join('\n')
  const add = added.join('\n')
  const rules: VersionRule[] = []
  const addRule = (kind: VersionRule['kind'], subject: string, direction: VersionRule['direction']) => {
    rules.push({ kind, subject, direction, count: 1, files: [], examples: [] })
  }
  // ① 短语删除：before 里出现的口语词/口头禅在 after 里少（或消失）→ 作者回避该短语
  for (const p of dict) {
    const cBefore = countPhraseInText(rem, p)
    const cAfter = countPhraseInText(add, p)
    if (cBefore > cAfter) addRule('removed-phrase', p, 'avoids')
  }
  const sRem = splitSentences(rem)
  const sAdd = splitSentences(add)
  const maxRemLen = sRem.reduce((m, s) => Math.max(m, s.length), 0)
  const maxAddLen = sAdd.reduce((m, s) => Math.max(m, s.length), 0)
  // ② 长句拆短：改前 1 句且 ≥25 字 → 改后 ≥2 句（作者把长句拆开=节奏偏好）
  if (sRem.length >= 1 && sAdd.length > sRem.length && sAdd.length >= 2 && maxRemLen >= 25) {
    addRule('split-sentence', '长句', 'prefers')
  }
  // ③ 短句合并：改前 ≥2 短句（均 <20 字）→ 改后 1 句且较长（作者偏好连贯长句）
  if (sRem.length >= 2 && sAdd.length === 1 && maxAddLen >= 30 && sRem.every((s) => s.length < 20)) {
    addRule('merged-sentence', '短句', 'prefers')
  }
  // ④ 整体精简/铺陈：其余明显长度变化（±8 字符以上），不与 ①②③ 抢道（结构调整更具体，先报结构）
  if (rules.length === 0) {
    const lenDiff = rem.length - add.length
    if (lenDiff >= 8) addRule('shortened', '篇幅', 'prefers')
    else if (lenDiff <= -8) addRule('lengthened', '篇幅', 'prefers')
  }
  return rules
}

export interface ExtractRulesOpts {
  /** 追加到短语检测的作者词表（与 overuse 自定义词表同源，AppSettings.overuseDict） */
  dict?: string[]
  /** 每条规则保留的示例上限（默认 3） */
  exampleLimit?: number
  /** 短语检测词表上限（防极端 dict 拖慢；默认与内置合并去重后取前 200 条） */
  maxDictEntries?: number
}

/** 版本 diff 规则提取：changes 只收 file 以「正文/」开头的（脱敏口径）；规则按 count 降序。 */
export function extractVersionRules(changes: VersionChange[], opts: ExtractRulesOpts = {}): VersionRule[] {
  const dict = [...new Set([...BUILTIN_OVERUSE, ...normalizeOveruseDict(opts.dict)])].slice(
    0,
    opts.maxDictEntries ?? 200
  )
  const exampleLimit = opts.exampleLimit ?? 3
  const byKey = new Map<string, VersionRule>()
  for (const c of changes) {
    if (!c.file.startsWith('正文/')) continue
    // 只对可见正文做 diff（剥约定头/注释/markdown 行内符号）——约定头改动（题名/切片）不算写作习惯
    const before = visibleBodyOf(c.before)
    const after = visibleBodyOf(c.after)
    if (before === after) continue
    for (const h of diffHunks(before, after)) {
      for (const r of analyzeHunk(h.removed, h.added, dict)) {
        const key = r.kind + '|' + r.subject
        let rule = byKey.get(key)
        if (!rule) {
          rule = { ...r, files: [], examples: [] }
          byKey.set(key, rule)
        } else {
          rule.count += r.count
        }
        // 出处聚合（按 file）
        const f = rule.files.find((x) => x.file === c.file)
        if (f) f.count += 1
        else rule.files.push({ file: c.file, count: 1 })
        // 示例（去重：同一 before 只留一次）
        const ex: DiffExample = { before: CUT80(h.removed.join('\n')), after: CUT80(h.added.join('\n')) }
        if (rule.examples.length < exampleLimit && !rule.examples.some((e) => e.before === ex.before)) {
          rule.examples.push(ex)
        }
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count)
}

// =====================================================================
// 二、提案采纳统计（信号源②：.zhijuan/proposals/<id>.json）
// =====================================================================

export interface ProposalStats {
  total: number
  byStatus: { pending: number; accepted: number; rejected: number; stale: number }
  /** 按来源聚合（source 维）：acceptRate=accepted/(accepted+rejected)，无可决样本=null */
  bySource: { source: string; total: number; accepted: number; rejected: number; acceptRate: number | null }[]
  /** 按条目类型聚合（kind 维，items 逐一计入） */
  byKind: { kind: string; total: number; accepted: number; rejected: number; acceptRate: number | null }[]
  /** 被拒条目样例（≤5 条；before/after 各截 120 字符）——转草稿「作者回避什么」 */
  rejectedExamples: { source: string; kind: string; before: string; after: string }[]
}

const CUT120 = (s: string) => (s.length > 120 ? s.slice(0, 120) + '…' : s)

const rate = (a: number, r: number): number | null =>
  a + r === 0 ? null : Math.round((a / (a + r)) * 1000) / 10

/** 提案采纳统计：空库→全零结构（不崩）；只统计 status 可决的接受率（pending/stale 计入 total 不计入率）。 */
export function summarizeProposals(proposals: Proposal[]): ProposalStats {
  const byStatus = { pending: 0, accepted: 0, rejected: 0, stale: 0 }
  const srcMap = new Map<string, { total: number; accepted: number; rejected: number }>()
  const kindMap = new Map<string, { total: number; accepted: number; rejected: number }>()
  const rejectedExamples: ProposalStats['rejectedExamples'] = []
  for (const p of proposals) {
    byStatus[p.status] += 1
    const s = srcMap.get(p.source) ?? { total: 0, accepted: 0, rejected: 0 }
    s.total += 1
    if (p.status === 'accepted') s.accepted += 1
    else if (p.status === 'rejected') s.rejected += 1
    srcMap.set(p.source, s)
    for (const item of p.items) {
      const k = kindMap.get(item.kind) ?? { total: 0, accepted: 0, rejected: 0 }
      k.total += 1
      if (p.status === 'accepted') k.accepted += 1
      else if (p.status === 'rejected') k.rejected += 1
      kindMap.set(item.kind, k)
      if (p.status === 'rejected' && rejectedExamples.length < 5) {
        rejectedExamples.push({
          source: p.source,
          kind: item.kind,
          before: CUT120(item.before),
          after: CUT120(item.after)
        })
      }
    }
  }
  const bySource = [...srcMap.entries()]
    .map(([source, v]) => ({ source, ...v, acceptRate: rate(v.accepted, v.rejected) }))
    .sort((a, b) => b.total - a.total)
  const byKind = [...kindMap.entries()]
    .map(([kind, v]) => ({ kind, ...v, acceptRate: rate(v.accepted, v.rejected) }))
    .sort((a, b) => b.total - a.total)
  return { total: proposals.length, byStatus, bySource, byKind, rejectedExamples }
}

// =====================================================================
// 三、用词句法聚合（信号源③：正文全文；口头禅复用 wordfreq 口径）
// =====================================================================

export interface SyntaxStats {
  /** 统计对象：正文可见字符总数（剥约定头/注释/markdown 行内符号） */
  chars: number
  sentences: { count: number; avg: number; max: number; buckets: { label: string; count: number }[] }
  paragraphs: { count: number; avg: number; buckets: { label: string; count: number }[] }
  /** 高频口头禅 top（overuseCheck 同口径：count/perK/severity） */
  topPhrases: { phrase: string; count: number; perK: number; severity: 'high' | 'medium' | 'low' }[]
}

const SENT_BUCKETS: { label: string; test: (n: number) => boolean }[] = [
  { label: '≤14', test: (n) => n <= 14 },
  { label: '15–24', test: (n) => n >= 15 && n <= 24 },
  { label: '25–39', test: (n) => n >= 25 && n <= 39 },
  { label: '40–59', test: (n) => n >= 40 && n <= 59 },
  { label: '≥60', test: (n) => n >= 60 }
]

const PARA_BUCKETS: { label: string; test: (n: number) => boolean }[] = [
  { label: '≤60', test: (n) => n <= 60 },
  { label: '61–150', test: (n) => n >= 61 && n <= 150 },
  { label: '151–300', test: (n) => n >= 151 && n <= 300 },
  { label: '>300', test: (n) => n > 300 }
]

function bucketCounts(nums: number[], buckets: { label: string; test: (n: number) => boolean }[]): { label: string; count: number }[] {
  return buckets.map((b) => ({ label: b.label, count: nums.filter((n) => b.test(n)).length }))
}

/** 用词句法聚合：chapters=[{file, raw}]（raw 含约定头原样）。
 *  topPhrases 默认 5 条（按次数降序）；句长=可见字符数（与 countWords 剥离口径同源），零分词器。 */
export function syntaxStats(
  chapters: { file: string; raw: string }[],
  opts: { topPhrases?: number; dict?: string[] } = {}
): SyntaxStats {
  const bodies = chapters.map((c) => visibleBodyOf(c.raw))
  const full = bodies.join('\n')
  const sentences = splitSentences(full)
  const sLens = sentences.map((s) => s.length)
  const paras = full
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const pLens = paras.map((p) => p.length)
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0)
  const top = overuseCheck(chapters, { minCount: 2, dict: opts.dict })
    .slice(0, opts.topPhrases ?? 5)
    .map((e) => ({ phrase: e.phrase, count: e.count, perK: Math.round(e.perK * 10) / 10, severity: e.severity }))
  return {
    chars: full.length,
    sentences: {
      count: sentences.length,
      avg: avg(sLens),
      max: sLens.reduce((m, n) => Math.max(m, n), 0),
      buckets: bucketCounts(sLens, SENT_BUCKETS)
    },
    paragraphs: {
      count: paras.length,
      avg: avg(pLens),
      buckets: bucketCounts(pLens, PARA_BUCKETS)
    },
    topPhrases: top
  }
}

// =====================================================================
// 四、信号组装 / 草稿生成 / 报告生成 / 门控
// =====================================================================

export interface WritingSignals {
  versionRules: VersionRule[]
  adoptStats: ProposalStats
  syntax: SyntaxStats
}

export function buildSignals(input: {
  changes: VersionChange[]
  proposals: Proposal[]
  chapters: { file: string; raw: string }[]
  dict?: string[]
}): WritingSignals {
  return {
    versionRules: extractVersionRules(input.changes, { dict: input.dict }),
    adoptStats: summarizeProposals(input.proposals),
    syntax: syntaxStats(input.chapters, { dict: input.dict })
  }
}

/** 证据强度：强=≥5 次观察 / 中=2–4 次 / 弱=1 次（对齐 skill-creator「主观输出定性评估」：只标注不自动应用） */
export function evidenceOf(count: number): '强' | '中' | '弱' {
  if (count >= 5) return '强'
  if (count >= 2) return '中'
  return '弱'
}

/** 草稿正文规则条目（通用化：不含章号/具体数字；给 agent 解释「为什么」） */
function ruleLine(rule: VersionRule): string {
  const ev = evidenceOf(rule.count)
  let act: string
  let why: string
  switch (rule.kind) {
    case 'removed-phrase':
      act = `作者回避「${rule.subject}」这一写法`
      why = '该表述复用过多会让文风显重复'
      break
    case 'split-sentence':
      act = '作者倾向把长句拆成短句'
      why = '长短句交替更有节奏、读者呼吸感更好'
      break
    case 'merged-sentence':
      act = '作者倾向把相邻短句合并成连贯长句'
      why = '连贯长句利于情绪铺陈'
      break
    case 'shortened':
      act = '作者倾向精简篇幅'
      why = '精简表达更利落'
      break
    default:
      act = '作者倾向充分铺陈'
      why = '充分铺陈更有画面感'
  }
  const ex = rule.examples[0]
  const exText = ex ? `；示例：「${ex.before}」→「${ex.after}」` : ''
  return `- [${ev}] ${act}（观察 ${rule.count} 次）——${why}${exText}`
}

export interface DraftOpts {
  /** 生成时间（用于草稿头注日期） */
  generatedAt?: Date
  /** 草稿技能名（英文 kebab；默认 writing-habits——与 skillNameValid 口径一致，转正时目录名需同名） */
  name?: string
  /** 描述（≤500；默认自动拼接） */
  description?: string
}

/** 从信号直出 SKILL.md 草稿文本（front matter：name/description/triggers/arguments/disabled:true）。
 *  产出为「草稿」（默认禁用），作者在设置页技能管理审阅后转正=参与注入/匹配（D-L-1/2/3/6）。 */
export function draftSkillFromStats(signals: WritingSignals, opts: DraftOpts = {}): string {
  const when = opts.generatedAt ?? new Date()
  const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
  const name = opts.name ?? 'writing-habits'
  const description =
    opts.description ??
    `创作时遵循作者已养成的写作习惯（由织卷依据近期正文改动、提案取舍与用词句法统计自动学习生成草稿，审阅后转正启用）`
  const rules = signals.versionRules
    .filter((r) => r.count >= 1)
    .slice(0, 8)
    .map(ruleLine)
  const phrases = signals.syntax.topPhrases
    .slice(0, 5)
    .map((p) => `- 「${p.phrase}」出现 ${p.count} 次（每千字 ${p.perK} 次）${p.severity === 'high' ? '（高频，注意复用）' : ''}`)
  const adopt = signals.adoptStats
  const acceptLine =
    adopt.byStatus.accepted + adopt.byStatus.rejected > 0
      ? `最近共收到 ${adopt.total} 条建议，采纳 ${adopt.byStatus.accepted} 条、拒绝 ${adopt.byStatus.rejected} 条。`
      : ''
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${description.slice(0, 500)}`,
    'triggers: [写作习惯, 我的风格, 文风]',
    'arguments: [用途]',
    'disabled: true',
    '---',
    '',
    `## 我的写作习惯（草稿 · 生成于 ${date}）`,
    '',
    '> 本技能由织卷从创作行为自动生成，**默认禁用**；审阅后在设置页「技能管理」转正即可启用。',
    '> 规则按证据强度标注（强=≥5 次观察 / 中=2–4 次 / 弱=1 次）；示例仅为佐证，以规则表述为准。',
    '',
    '### 正文改动倾向',
    ...(rules.length ? rules : ['- （暂无足够改动样本）']),
    '',
    '### 用词与句法现状',
    ...(phrases.length ? phrases : ['- （暂无高频词样本）']),
    '',
    `- 平均句长 ${signals.syntax.sentences.avg} 字、最长 ${signals.syntax.sentences.max} 字；短句（≤14 字）占 ${
      signals.syntax.sentences.count ? Math.round((signals.syntax.sentences.buckets[0].count / signals.syntax.sentences.count) * 100) : 0
    }%。`,
    '',
    '### 对 Agent 的提示',
    '创作正文时按上述偏好处理句式与用词；如与当前章节意图冲突（如刻意拉长节奏），以作者当轮意图为准。',
    '',
    acceptLine
  ]
  return lines.join('\n') + '\n'
}

/** 人读报告：Executive summary / Key findings / Recommendations 三段（skill-creator 报告结构对齐）。 */
export function reportFromStats(signals: WritingSignals, opts: { generatedAt?: Date } = {}): string {
  const when = opts.generatedAt ?? new Date()
  const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
  const s = signals.syntax
  const a = signals.adoptStats
  const rules = signals.versionRules
  const findings: string[] = []
  for (const r of rules.slice(0, 6)) {
    const files = r.files.map((f) => `${f.file}×${f.count}`).join('、')
    const act =
      r.kind === 'removed-phrase'
        ? `作者删减了「${r.subject}」`
        : r.kind === 'split-sentence'
          ? `作者偏好长句拆短`
          : r.kind === 'merged-sentence'
            ? `作者偏好短句合并`
            : r.kind === 'shortened'
              ? `作者偏好精简`
              : `作者偏好铺陈`
    findings.push(`- [${evidenceOf(r.count)}] ${act}（观察 ${r.count} 次；${files}）`)
  }
  if (a.byStatus.accepted + a.byStatus.rejected > 0) {
    const top = a.bySource[0]
    findings.push(
      `- 建议采纳倾向：共 ${a.total} 条，采纳 ${a.byStatus.accepted} / 拒绝 ${a.byStatus.rejected}${
        top && top.acceptRate !== null ? `；${top.source} 接受率 ${top.acceptRate}%` : ''
      }`
    )
  }
  if (s.topPhrases.length) {
    findings.push(
      `- 高频短语：${s.topPhrases
        .slice(0, 3)
        .map((p) => `「${p.phrase}」${p.count} 次（${p.perK}/千字）`)
        .join('；')}`
    )
  }
  const recs: string[] = []
  const strong = rules.find((r) => r.count >= 3 && r.kind !== 'shortened' && r.kind !== 'lengthened')
  if (strong) recs.push(`- 「${strong.subject}」相关规则证据充分（${strong.count} 次），建议审阅草稿后转正。`)
  if (s.topPhrases[0] && s.topPhrases[0].severity === 'high')
    recs.push(`- 「${s.topPhrases[0].phrase}」为高频口头禅，可考虑加入设置页自定义词表持续观察。`)
  if (a.byStatus.rejected > 0 && a.rejectedExamples.length)
    recs.push(`- 存在 ${a.byStatus.rejected} 条被拒建议（如「${a.rejectedExamples[0].before.slice(0, 30)}…」），观察是否为作者稳定取舍。`)
  if (!recs.length) recs.push('- 样本量不足，建议继续创作一段时间后再生成。')
  return [
    `# 写作习惯分析报告（${date}）`,
    '',
    '## Executive summary',
    `本期共分析 ${s.chars} 字正文（${s.sentences.count} 句 / ${s.paragraphs.count} 段）、${a.total} 条建议、${
      rules.reduce((n, r) => n + r.count, 0)
    } 处正文改动证据。平均句长 ${s.sentences.avg} 字。`,
    '',
    '## Key findings',
    ...(findings.length ? findings : ['- （暂无足够样本）']),
    '',
    '## Recommendations',
    ...recs,
    ''
  ].join('\n')
}

/** 门控：开关开 + 距上次分析 ≥7 天 + 项目有可分析信号，才允许跑。
 *  intervalMs 默认 7*24h（与 Grammarly 周报同频，D-L-4；本期不做频率配置）。 */
export function shouldRunInsights(opts: {
  enabled: boolean
  lastRunAt?: number
  now: number
  hasAnySignal: boolean
  intervalMs?: number
}): boolean {
  if (!opts.enabled) return false
  if (!opts.hasAnySignal) return false
  const interval = opts.intervalMs ?? 7 * 24 * 3600 * 1000
  if (typeof opts.lastRunAt === 'number' && opts.now - opts.lastRunAt < interval) return false
  return true
}

// =====================================================================
// 执行层/IPC 共享类型（增量 4c：下放 shared 作单一权威源——main 执行层 / preload 桥 / devShim mock 同引用）
// =====================================================================

/** 状态记账（.zhijuan/insights-state.json；与批注 done.json 同构）：上次成功生成的时间+草稿文件名 */
export interface InsightsState {
  lastRunAt: number
  lastDraft: string
}

/** runWritingInsights 结果：成功含产物路径；失败带 reason（disabled=开关关 / recent=7 天内已跑 / no-signal=无信号 / error=执行异常） */
export type InsightRunResult =
  | { ok: true; draftFile: string; reportFile: string; state: InsightsState }
  | { ok: false; reason: 'disabled' | 'recent' | 'no-signal' | 'error' }

/** 草稿区条目：kind=report 即「-报告.md」，其余 .md 为技能草稿（体验层列表区分标注） */
export type DraftKind = 'draft' | 'report'
export interface DraftEntry {
  fileName: string
  kind: DraftKind
  mtimeMs: number
}
