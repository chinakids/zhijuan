// 织卷 · 技能/聊天会话「工具探索面」统计器（诊断资产，2026-09-23 智能层）
// 用途：量化模型在聊天/技能轮自发用非 zj_* 工具（glob/bash/read/web_search…）探索文件系统的
// 实际成本——b5f2a39 只禁了引擎自带 tool-skill，但模型仍会 glob/bash/read 找技能文件
// （00:00 轮观察：显式 /技能名 场景 3-6 个探索步骤/次）。本脚本产出：每会话工具分布、
// 非 zj_* 探索调用次数/耗时占比、探索目标分类（技能文件 vs 其他）。
// 判据口径（候选 1）：探索占比 = 非 zj_* 探索类调用数 / 全部工具调用数；
//                        耗时占比 = 探索类调用耗时 / 全部工具调用耗时（call→result）。
// 用法：node scripts/skill-explore-toolstats.mjs [最近会话数，默认 40] [sessionsDir]
//   默认 sessionsDir=dsh-runtime/dshhome/sessions（自动定位 workdir 会话根，同 subtask-toolstats）
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const N = Number(process.argv[2] || 40)
const dir = process.argv[3] || 'dsh-runtime/dshhome/sessions'
let base = resolve(root, dir)
if (!existsSync(base)) { console.error('sessionsDir 不存在:', base); process.exit(1) }
const subs = readdirSync(base).filter((n) => {
  try { return statSync(join(base, n)).isDirectory() } catch { return false }
})
const real = subs.filter((n) => n.includes('dsh-runtime'))
const work = real.length === 1 ? join(base, real[0]) : base

const entries = readdirSync(work).filter((n) => existsSync(join(work, n, 'session.jsonl.zstd')))
entries.sort((a, b) => statSync(join(work, b)).mtimeMs - statSync(join(work, a)).mtimeMs)

// 探索类 = 文件系统/网络读取面（模型自发找资料/技能文件）；非 zj_* 的其他（ask/todo）另计
const EXPLORE = new Set(['glob', 'bash', 'read', 'write', 'web_search', 'web_fetch', 'ls', 'grep', 'find', 'cat', 'pwd', 'rm', 'curl', 'touch'])
const OTHER_NONZJ = new Set(['ask_user_question', 'todo'])

function parseLine(ln) { try { return JSON.parse(ln) } catch { return null } }

const sessions = []
const total = { chat: 0, skillHit: 0, calls: 0, explore: 0, exploreMs: 0, allMs: 0, errs: 0 }
const byExplain = {}

for (const name of entries.slice(0, N)) {
  const p = join(work, name, 'session.jsonl.zstd')
  let raw
  try {
    raw = execFileSync('zstd', ['-dc', p], { maxBuffer: 512 * 1024 * 1024, encoding: 'utf-8' })
  } catch { continue }
  let prompt = ''
  let isChat = false, skillHit = false
  let t0 = 0, tEnd = 0
  const calls = new Map() // callId -> {name, t, args}
  const results = new Map() // callId -> {t, err}
  for (const ln of raw.split('\n')) {
    const o = parseLine(ln)
    if (!o) continue
    if (o.type === 'agent/inbox/spliced' && !prompt) {
      prompt = JSON.stringify(o.data?.inserted ?? [])
      if (!t0) t0 = o.time || 0
    } else if (o.type === 'tool/call') {
      calls.set(o.data?.callId, { name: o.data?.name, t: o.time, args: o.data?.arguments })
    } else if (o.type === 'tool/result') {
      const m = o.data?.message
      const source = m?.source
      if (source?.kind === 'tool') {
        const content = JSON.stringify(m?.content ?? '')
        results.set(source.callId, { t: o.time, err: m?.content?.some?.((c) => c?.isError ?? false) || false })
      }
    }
    if (o.time && o.time > tEnd) tEnd = o.time
  }
  isChat = prompt.includes('【输出纪律】')
  skillHit = prompt.includes('【技能：')
  if (!isChat) continue // 只统计聊天/技能会话
  total.chat++

  const list = []
  for (const [id, c] of calls) {
    const r = results.get(id)
    const ms = r ? r.t - c.t : null
    const isZj = c.name.startsWith('zj_') || c.name.startsWith('__')
    let kind = 'zj'
    if (!isZj && EXPLORE.has(c.name)) kind = 'explore'
    else if (!isZj && OTHER_NONZJ.has(c.name)) kind = 'other'
    else if (!isZj) kind = 'other'
    list.push({ name: c.name, ms, err: r?.err ?? false, kind, args: c.args })
  }
  const nExplore = list.filter((c) => c.kind === 'explore').length
  const nZj = list.filter((c) => c.kind === 'zj').length
  const msExplore = list.filter((c) => c.kind === 'explore').reduce((s, c) => s + (c.ms ?? 0), 0)
  const msAll = list.reduce((s, c) => s + (c.ms ?? 0), 0)
  const exploreTargets = [...new Set(list.filter((c) => c.kind === 'explore').map((c) => {
    let a = {}
    try { a = c.args ? JSON.parse(c.args) : {} } catch { /* args 非 JSON 时按原文 */ }
    const rawv = (c.name === 'glob' ? a.pattern : c.name === 'read' ? a.path : c.name === 'bash' ? a.command : c.name === 'web_search' ? a.query : c.args ?? '')
    return String(rawv ?? '').slice(0, 80)
  }))]
  sessions.push({ name, nCall: list.length, nExplore, nZj, msExplore, msAll, skillHit, targets: exploreTargets, byTool: {}, durS: (tEnd - t0) / 1000 })
  const s = sessions[sessions.length - 1]
  for (const c of list) s.byTool[c.name] = (s.byTool[c.name] ?? 0) + 1
  if (skillHit) total.skillHit++
  total.calls += list.length
  total.explore += nExplore
  total.exploreMs += msExplore
  total.allMs += msAll
  for (const c of list) { if (c.kind === 'explore') byExplain[c.name] = (byExplain[c.name] ?? 0) + 1 }
}

console.log(`扫描最近 ${N} 会话，其中聊天/技能会话 ${total.chat} 个（技能命中 ${total.skillHit}）`)
console.log(`汇总：工具调用 ${total.calls} 次 | 探索类 ${total.explore} 次（${(total.explore / Math.max(1, total.calls) * 100).toFixed(1)}%）| 探索耗时 ${(total.exploreMs / 1000).toFixed(1)}s / 全部 ${(total.allMs / 1000).toFixed(1)}s（${(total.exploreMs / Math.max(1, total.allMs) * 100).toFixed(1)}%）`)
console.log(`探索工具类型分布=${JSON.stringify(byExplain)}`)
console.log(`\n逐会话（非 zj 探索标 ▶，技能命中标 ★）：`)
const withExplore = [], noExplore = []
for (const s of sessions) {
  const pct = s.nCall ? (s.nExplore / s.nCall * 100).toFixed(0) : 0
  ;(s.nExplore > 0 ? withExplore : noExplore).push(s)
  console.log(`${s.skillHit ? '★' : ' '} ${s.name}`)
  console.log(`   调用=${s.nCall} 探索=${s.nExplore}(${pct}%) 探索耗时=${(s.msExplore / 1000).toFixed(1)}s/全部${(s.msAll / 1000).toFixed(1)}s 会话时长=${(s.durS / 60).toFixed(1)}min  工具=${JSON.stringify(s.byTool)}`)
  if (s.targets.length) console.log(`   探索目标=${s.targets.join(' | ')}`)
}
const avg = (arr, f) => arr.length ? (arr.reduce((s, x) => s + f(x), 0) / arr.length) : 0
console.log(`\n时长相较：有探索会话 ${withExplore.length} 个（均长 ${(avg(withExplore, (s) => s.durS) / 60).toFixed(1)}min） vs 无探索会话 ${noExplore.length} 个（均长 ${(avg(noExplore, (s) => s.durS) / 60).toFixed(1)}min）`)
