// 织卷 · 导演板（director）· 纯逻辑（无 Electron 依赖）
// M2 核心：把「情绪曲线 + 人物曲线」从被动描述，升级为每段落的硬性导演命令。
// 关键升级点：
//   1. 每段给出「戏剧任务」——要达到的强度、情绪基调、必须发生的转变；
//   2. 落差检测——相邻段大幅波动（骤升/猛跌）时，强制要求「必须用具体事件撑起这个变化」；
//   3. 波峰/波谷定位——本章最高点（climax）与最低点（nadir），作为写作的锚。
// 曲线不是建议，是导演手里的剧本沙盘。
import type { SeriesCurve, PlotBeat, CurvePoint } from './types.ts'

export interface ShotPlan {
  seg: number
  fromPct: number
  toPct: number
  intensity: number // 本段平均强度 0-100
  climax: boolean // 本章波峰所在段
  nadir: boolean // 本章波谷所在段
  jumps: { from: number; to: number; dir: '骤升' | '猛跌' }[] // 本段发生的剧烈落差
  beats: string[] // 落在本段的节拍点
  curves: { name: string; trend: string; value: number }[] // 每条曲线在本段的走向与均值
}

export const DIRECTOR = {
  segs: 8,
  jumpThreshold: 18, // 相邻段强度变化超过此值视为需要事件撑起的落差
  beatEveryJump: true
}

function valueAt(pts: CurvePoint[], x: number): number {
  if (!pts || pts.length === 0) return 50
  const sorted = [...pts].sort((a, b) => a.x - b.x)
  if (x <= sorted[0].x) return sorted[0].y
  if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x)
      return a.y + (b.y - a.y) * t
    }
  }
  return 50
}

function trend(v0: number, v1: number): string {
  const diff = v1 - v0
  if (diff > 30) return '骤升' // 强事件段
  if (diff > 10) return '缓升'
  if (diff < -30) return '猛跌' // 反差/落差段
  if (diff < -10) return '缓降'
  if (Math.abs(diff) <= 10) return '缠斗' // 拉锯，靠细节撑
  return '平缓'
}

/** 把一组曲线 + 情节点，编排成一段一段的导演板 */
export function makeDirectorBoard(curves: SeriesCurve[], beats: PlotBeat[]): ShotPlan[] {
  const segs = DIRECTOR.segs
  const plans: ShotPlan[] = []
  const beatTexts = (beats ?? []).map((b) => ({ at: b.at, label: `${b.label}（${b.note}）` }))

  // 找出全局最高/最低点（用情绪曲线中的第一条作为主曲线；没有曲线时平铺）
  const prime = (curves ?? []).find((c) => c.kind === 'emotion') ?? (curves ?? [])[0]
  let peakSeg = -1
  let nadirSeg = -1
  let peak = -1
  let nad = 101
  for (let s = 0; s < segs; s++) {
    const x0 = (s / segs) * 100
    const x1 = ((s + 1) / segs) * 100
    const avg = (valueAt(prime?.points ?? [], x0) + valueAt(prime?.points ?? [], x1)) / 2
    if (avg > peak) {
      peak = avg
      peakSeg = s
    }
    if (avg < nad) {
      nad = avg
      nadirSeg = s
    }
  }

  let prev: { s: number; v: number } | null = null
  for (let s = 0; s < segs; s++) {
    const x0 = (s / segs) * 100
    const x1 = ((s + 1) / segs) * 100
    const jumps: { from: number; to: number; dir: '骤升' | '猛跌' }[] = []
    const cv = (curves ?? []).map((c) => {
      const v0 = valueAt(c.points ?? [], x0)
      const v1 = valueAt(c.points ?? [], x1)
      const dd = v1 - v0
      const dir = trend(v0, v1)
      if (Math.abs(dd) >= DIRECTOR.jumpThreshold) {
        jumps.push({ from: Math.round(v0), to: Math.round(v1), dir: dd > 0 ? '骤升' : '猛跌' })
      }
      return { name: c.name, trend: dir, value: Math.round((v0 + v1) / 2) }
    })
    const bs = beatTexts.filter((b) => b.at >= x0 && b.at < x1).map((b) => b.label)
    const avg = (valueAt(prime?.points ?? [], x0) + valueAt(prime?.points ?? [], x1)) / 2
    if (prev && Math.abs(Math.round(avg) - prev.v) >= DIRECTOR.jumpThreshold) {
      jumps.push({ from: prev.v, to: Math.round(avg), dir: avg > prev.v ? '骤升' : '猛跌' })
    }
    prev = { s, v: Math.round(avg) }
    plans.push({
      seg: s + 1,
      fromPct: Math.round(x0),
      toPct: Math.round(x1),
      intensity: Math.round(avg),
      climax: s === peakSeg,
      nadir: s === nadirSeg,
      jumps,
      beats: bs,
      curves: cv
    })
  }
  return plans
}

/** 把导演板渲染成写给模型的分段指令（进 prompt） */
export function renderDirectorBoard(projectName: string, plans: ShotPlan[]): string {
  const rows = plans.map((p) => {
    const tags: string[] = []
    if (p.climax) tags.push('本章最高潮')
    if (p.nadir) tags.push('本章最低谷')
    const jumpNote = p.jumps.length
      ? '；本段存在强度落差（' + p.jumps.map((j) => `${j.dir} ${j.from}→${j.to}`).join('、') + '），必须用一件具体事件撑起这个变化，不能让读者觉得突然' 
      : ''
    const task =
      p.intensity >= 70
        ? '白热化：迎着前面的铺垫往上顶，正面交锋或关键反转必须落地' 
        : p.intensity >= 45
        ? '推进：细节要具体，动作要有进展，情感要有进位' 
        : p.intensity <= 25
        ? '低谷：留白与伏笔，铺垫即将到来的反弹' 
        : '拉锯：要有足够的细节和张力细节，把这份热度维持住'
    return (
      `- 段${p.seg}（${p.fromPct}%-${p.toPct}%）·强度 ${p.intensity}${' · ' + tags.join('/')}` +
      `：本段任务 = ${task}` +
      (p.curves.length
        ? `；曲线走向：${p.curves.map((c) => `「${c.name}」${c.trend}(${c.value})`).join('、')}`
        : '') +
      (p.beats.length ? `；此处落实情节点：${p.beats.join('、')}` : '') +
      jumpNote
    )
  })
  return (
    `以下是《${projectName}》本章的「导演板」。每段都是硬指令：人物行为、事件烈度必须配得上本段的强度与走向；落差段必须由具体事件承载。按序推进，不能跳段、不能把高潮提前或拖后：\n` +
    rows.join('\n')
  )
}
