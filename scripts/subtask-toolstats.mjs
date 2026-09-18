// 织卷 · 子任务会话工具调用统计器（诊断资产，2026-09-19 智能层）
// 用途：subtaskEnvBlock 坐标修复（cab8caf）效果量化的可复用工具——统计 dsh 引擎会话日志
// （dsh-runtime/dshhome/sessions/*/session.jsonl.zstd）里模型真实调用的工具行为：
// 调用次数/工具分布/isError/疑似空结果（0 files|没有找到|未找到|不存在…），并识别 prompt 是否含
// 【作品根目录】（subtaskEnvBlock 是否注入）。改子任务装配/env 块/工具层后跑子任务冒烟，
// 再用本脚本对比工具行为（对照=https://www.anthropic.com/engineering/building-effective-agents
// Appendix 2「Test how the model uses your tools」——工具使用行为是可测的 ACI 回归面）。
// 用法：node scripts/subtask-toolstats.mjs [nameFilter] [sessionsDir]
//   默认 sessionsDir=dsh-runtime/dshhome/sessions/<workdir哈希>（懒指向：直接传目录更稳）；
//   例：node scripts/subtask-toolstats.mjs audit-
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const filt = process.argv[2] || ''
const dir = process.argv[3] || 'dsh-runtime/dshhome/sessions'
// 找包含本仓库路径的会话根（session 目录名=workdir 的 URL 编码哈希）
let base = resolve(root, dir)
if (!existsSync(base)) { console.error('sessionsDir 不存在:', base); process.exit(1) }
const subs = existsSync(base) ? readdirSync(base) : []
const real = subs.filter((n) => n.includes('dsh-runtime')).sort()
const work = real.length === 1 ? join(base, real[0]) : base
if (!existsSync(work)) { console.error('未找到会话根目录'); process.exit(1) }

const EMPTY_RE = /0 files|没有找到|没有匹配|未找到|不存在|未匹配|没有文档|空结果|has 0|no files|not found/i

const entries = readdirSync(work).filter((n) => {
  if (!n.includes(filt)) return false
  return existsSync(join(work, n, 'session.jsonl.zstd'))
}).sort()

for (const name of entries) {
  const p = join(work, name, 'session.jsonl.zstd')
  let raw
  try {
    raw = execFileSync('zstd', ['-dc', p], { maxBuffer: 256 * 1024 * 1024, encoding: 'utf-8' })
  } catch (e) {
    console.log(name, '=> zstd 失败', String(e?.message).slice(0, 120))
    continue
  }
  const lines = raw.split('\n').filter(Boolean)
  let calls = 0
  const byTool = {}
  let errs = 0
  let empties = 0
  const emptySamples = []
  let hasEnv = false
  let firstPromptAt = 0
  for (const ln of lines) {
    let o
    try { o = JSON.parse(ln) } catch { continue }
    const t = o.type
    if (t === 'agent/inbox/spliced') {
      const txt = JSON.stringify(o.data?.inserted ?? [])
      if (txt.includes('【作品根目录】')) hasEnv = true
      if (!firstPromptAt) firstPromptAt = o.time || 0
    } else if (t === 'tool/call') {
      calls++
      const n = o.data?.name || '?'
      byTool[n] = (byTool[n] ?? 0) + 1
    } else if (t === 'tool/result') {
      const txt = JSON.stringify(o.data?.message?.content ?? '')
      if (o.data?.message?.content?.some?.((c) => c?.isError)) errs++
      if (EMPTY_RE.test(txt)) {
        empties++
        if (emptySamples.length < 3) {
          const m = txt.match(/text":"[^"]{0,200}/)
          emptySamples.push(m?.[0]?.slice(0, 130) ?? txt.slice(0, 130))
        }
      }
    }
  }
  const d = new Date(firstPromptAt)
  console.log(`\n[${name}]`)
  console.log(`  prompt含作品根目录=${hasEnv}  首轮时刻=${d.toISOString()}  事件行=${lines.length}`)
  console.log(`  tool/call=${calls}  isError=${errs}  疑似空结果=${empties}`)
  console.log(`  工具分布=${JSON.stringify(byTool)}`)
  if (emptySamples.length) console.log(`  空结果样例: ${emptySamples.join(' ||| ')}`)
}
