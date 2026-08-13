// 织卷 · 分幕（acts）· 纯逻辑（无 Electron 依赖）
// M2.2：把导演板（8 段）按戏份轻重切成 3~6 幕，每幕单独生成、承接上一幕终态，支持回滚到某幕重生成。
// 幕不是装饰：每幕带着自己的戏剧任务走，幕间靠「上一幕末状态」续接，从机制上让曲线契约整章贯彻、
// 也把「一锤子生整章 → 曲线契约在中间流失」的老问题拆开处理。
import type { PlotBeat } from './types.ts'
import { DIRECTOR, type ShotPlan } from './director.ts'
import { renderShotRow } from './director.ts'

/** 一幕的规划（由 1..8 连续若干段组成） */
export interface ActPlan {
  index: number // 0 起
  segStart: number // 本幕起始段号（1 起，含）
  segEnd: number // 本幕结束段号（含）
  tone: '白热' | '推进' | '低谷' | '拉锯' // 本幕主调（按最强段定）
  title: string // 写进 prompt 的幕名，如「第2幕 · 推进」
  segs: ShotPlan[] // 本幕包含的段
  climax: boolean
  nadir: boolean
  hasJump: boolean // 本幕至少一段含落差（必须用具体事件承载）
}

export const ACTS = {
  min: 3, // 最少幕数
  max: 6, // 最多幕数
  weightPerAct: 4, // 按「每幕能扛多少戏份」反推幕数
  prevStateChars: 1000 // 上一幕末状态带进下一幕的最大字数
}

function segWeight(p: ShotPlan): number {
  let w = 1
  if (p.climax) w += 2
  if (p.nadir) w += 2
  if (p.jumps.length) w += 2
  if (p.beats.length) w += 1
  return w
}

function toneOf(p: ShotPlan): ActPlan['tone'] {
  if (p.intensity >= 70) return '白热'
  if (p.intensity >= 45) return '推进'
  if (p.intensity <= 25) return '低谷'
  return '拉锯'
}

/** 权重均衡的线性切分：把前 n 段切成 k 段连续组，使「最重」的组尽量轻（附平方和作次级目标让戏份分散） */
function splitGroups(weights: number[], k: number): number[][] {
  const n = weights.length
  // dp[i][j] = 把前 i 段切成 j 组的（最大组重, 平方和）最优下界
  const MAX = 1e9
  const best = Array.from({ length: n + 1 }, () => new Array(k + 1).fill([MAX, MAX]).slice())
  const cut = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(-1))
  best[0][0] = [0, 0]
  const prefix = [0]
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + weights[i])
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= Math.min(i, k); j++) {
      // 最后一段 [t, i) 作为第 j 组
      for (let t = j - 1; t < i; t++) {
        const prev = best[t][j - 1]
        if (prev[0] >= MAX) continue
        const w = prefix[i] - prefix[t]
        const cand: [number, number] = [Math.max(prev[0], w), prev[1] + w * w]
        if (cand[0] < best[i][j][0] || (cand[0] === best[i][j][0] && cand[1] < best[i][j][1])) {
          best[i][j] = cand
          cut[i][j] = t
        }
      }
    }
  }
  // 回溯
  const groups: number[][] = []
  let end = n
  for (let j = k; j >= 1; j--) {
    const start = cut[end][j]
    groups.unshift(weights.slice(start, end))
    end = start
  }
  return groups
}

/** 把导演板按戏份切成 3~6 幕（顺序完整覆盖所有段；波峰所在段只属于一幕） */
export function planActs(plans: ShotPlan[]): ActPlan[] {
  const segs: ShotPlan[] =
    (Array.isArray(plans) && plans.length === DIRECTOR.segs)
      ? plans
      : Array.from({ length: DIRECTOR.segs }, (_, i) => ({
          seg: i + 1, fromPct: Math.round((i / DIRECTOR.segs) * 100), toPct: Math.round(((i + 1) / DIRECTOR.segs) * 100),
          intensity: 50, climax: false, nadir: false, jumps: [], beats: [], curves: []
        }))
  const weights = segs.map(segWeight)
  const total = weights.reduce((a, b) => a + b, 0)
  const k = Math.min(ACTS.max, Math.max(ACTS.min, Math.ceil(total / ACTS.weightPerAct)))
  const groups = splitGroups(weights, k)
  const out: ActPlan[] = []
  let s = 0
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    const gsegs = segs.slice(s, s + g.length)
    const prime = [...gsegs].sort((a, b) => b.intensity - a.intensity)[0]
    const climax = gsegs.some((p) => p.climax)
    const nadir = gsegs.some((p) => p.nadir)
    const hasJump = gsegs.some((p) => p.jumps.length > 0)
    const tone = toneOf(prime)
    out.push({
      index: gi,
      segStart: gsegs[0].seg,
      segEnd: gsegs[gsegs.length - 1].seg,
      tone,
      title: `第${gi + 1}幕 · ${tone}`,
      segs: gsegs,
      climax,
      nadir,
      hasJump
    })
    s += g.length
  }
  return out
}

/** 一幕的导演指令（进 prompt 的“本幕要干什么”，只含本幕的段） */
export function renderActDirective(projectName: string, act: ActPlan, opts?: { prevState?: string }): string {
  const tags: string[] = []
  if (act.climax) tags.push('本章最高潮所在幕，必须把高潮写足写满')
  if (act.nadir) tags.push('本章最低谷所在幕，留白埋钩')
  const jumpNote = act.hasJump
    ? '；本幕存在强度落差，必须用一件具体事件撑起这个变化，不能让读者觉得突然'
    : ''
  const prevNote = opts?.prevState ? '紧接上一幕的结尾继续（上一幕末状态见下），不要重新开场、不要复述已发生的事件。' : '本章第一幕，需要先布好场、把人带进来。'
  return (
    `以下是你正在写的《${projectName}》本章第 ${act.index + 1} 幕（共 ${act.title}，覆盖进度 ${act.segs[0].fromPct}%-${act.segs[act.segs.length - 1].toPct}%${tags.length ? '，' + tags.join('，') : ''}）的导演指令：\n` +
    act.segs.map(renderShotRow).join('\n') +
    `\n本幕任务铁律：${prevNote} 每一句都压着本幕的强度写；结尾时把人物状态、现场情境定格清楚，留给下一幕作为起点。本幕篇幅约 ${act.segs.length >= 2 ? '1200' : '700'} 字。` +
    jumpNote
  )
}

/** 把各幕正文拼成章正文 */
export function joinActs(acts: string[]): string {
  return (acts ?? []).filter((a) => a && a.trim()).join('\n\n')
}

/** 回滚到某幕：保留前 fromAct 幕，之后的丢弃（重生成从 fromAct 开始） */
export function truncateActs(acts: string[], fromAct: number): string[] {
  if (!Array.isArray(acts)) return []
  return acts.slice(0, Math.max(0, Math.min(fromAct, acts.length)))
}

/** 取上一幕的结尾片段作为「上一幕末状态」带进下一幕的 prompt（尽量从段首截，避免截在句子中间） */
export function prevActState(acts: string[], idx: number, maxChars: number = ACTS.prevStateChars): string {
  const prev = (acts ?? [])?.[idx - 1]
  if (!prev) return ''
  const tail = prev.slice(-maxChars)
  const nl = tail.indexOf('\n')
  return nl > 0 && nl < 300 ? tail.slice(nl) : tail
}

/** 情节点按进度归到它对应的幕（供把节拍挂到幕上） */
export function beatsInAct(act: ActPlan, beats: PlotBeat[]): PlotBeat[] {
  const from = act.segs[0].fromPct
  const to = act.segs[act.segs.length - 1].toPct
  return (beats ?? []).filter((b) => b.at >= from && b.at <= to)
}
