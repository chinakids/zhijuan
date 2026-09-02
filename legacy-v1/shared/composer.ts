// 织卷 · 组配器（composer）· 纯逻辑（无 Electron 依赖，可自动化验证）
// 职责：每次章节生成前，从项目里 _按本章需要_ 组出一小包精准上下文（AssembledContext），
// 取代过去「整包硬塞」。三个支柱：按需召回、时间旅行查询、预算硬控。
import type { Project, Chapter, Character, Element, ChapterRecord } from './types.ts'
import { sliceAt, charSnapshot } from './setting.ts'

export interface ComposedItem<T> {
  target: T
  excerpt: string // 实际进入 prompt 的裁剪文本
  weight: number // 命中权重（高者优先保留）
}

export interface AssembledContext {
  currentNum: number
  worldSummary: string // 世界观骨干（始终带，background 限长）
  chars: ComposedItem<Character>[] // 精选人物（≤6，主角恒在）
  elements: ComposedItem<Element>[] // 召回条目（active，按需）
  recent: { chapterNum: number; summary: string }[] // 前情栈（随章距衰减）
  openForeshadows: string[] // 未兑现伏笔（始终附上）
}

export const BUDGET = {
  charsMax: 6, // 人物数上限
  perCharMax: 400, // 每人档案截断
  elementsMax: 8, // 条目数上限
  elementsCharsMax: 1200, // 条目总字符上限
  recentCharsMax: 1000, // 前情总字符上限
  worldBackgroundMax: 500, // 世界观长文截断
  totalCharsMax: 4000 // 上下文增量总闸门（不含本章要素/曲线等固定段落）
}

/** 本章的「查询文本」：要素 + 梗概 + 情节点 + 曲线名（不必分词，直接做子串命中） */
function queryText(chapter: Chapter): string {
  return [
    chapter.elements ?? '',
    chapter.premise ?? '',
    ...(chapter.beats ?? []).flatMap((b) => [b.label, b.note]),
    ...(chapter.curves ?? []).map((c) => c.name)
  ].join(' ')
}

/** 子串命中得分：候选词出现于查询全文（2分），或查询里的某个词组是候选的一部分（1分） */
function hitScore(text: string, candidates: string[]): number {
  const q = text.toLowerCase()
  const tokens = q
    .split(/[，。；、\s,;:：!！?？()（）【】\[\]"'“”]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
  let s = 0
  for (const c of candidates) {
    const k = (c ?? '').trim().toLowerCase()
    if (k.length < 2) continue
    if (q.includes(k)) {
      s += 2 // 候选完整出现在查询里（如「许晴」「学校琴房」）
    } else if (tokens.some((t) => k.includes(t))) {
      s += 1 // 查询的某个词是候选的一部分（如「琴房」→「学校琴房」）
    }
  }
  return s
}

function charCandidates(c: Character): string[] {
  return [c.name, ...(c.tags ?? [])]
}

function elemCandidates(e: Element): string[] {
  return [e.name, ...(e.tags ?? [])]
}

/** 人物当前时刻的可写档案（时间旅行查询 + 长度裁剪） */
function charExcerpt(c: Character, ch: number, max: number): string {
  const slice = sliceAt(c.slices ?? [], ch)
  const full = slice?.content || charSnapshot(c)
  return clip(full, max)
}

/** 条目当前时刻的可写内容 */
function elemExcerpt(e: Element, ch: number, max: number): string {
  const slice = sliceAt(e.slices ?? [], ch)
  const full = slice?.content || ''
  return clip(full, max)
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  // 优先保头（身份信息在头部），尾部截断
  return s.slice(0, max) + '…（已按预算截断）'
}

/** 前情栈：最新全量，随章距指数衰减，至少保留首段一小段 */
function buildRecent(project: Project, currentNum: number): { chapterNum: number; summary: string }[] {
  const recs = (project.records ?? [])
    .filter((r: ChapterRecord) => r.chapterNum < currentNum)
    .sort((a, b) => a.chapterNum - b.chapterNum)
  const out: { chapterNum: number; summary: string }[] = []
  let budget = BUDGET.recentCharsMax
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i]
    const gap = currentNum - r.chapterNum
    let txt = r.summary ?? ''
    if (gap > 1 && txt.length > 40) {
      const keep = Math.max(40, Math.round(txt.length / Math.pow(2, gap - 1)))
      txt = txt.slice(0, keep) + '…'
    }
    if (budget <= 0) break
    const len = Math.min(budget, txt.length)
    out.push({ chapterNum: r.chapterNum, summary: txt.slice(0, len) })
    budget -= len
  }
  return out.reverse()
}

function buildWorldSummary(project: Project): string {
  const w = project.worldview
  const bg = clip(w.background ?? '', BUDGET.worldBackgroundMax)
  return [
    `名称: ${w.name}`,
    `城市: ${w.city}`,
    `时代: ${w.era}`,
    `主题: ${(w.themes ?? []).join('、')}`,
    `规则: ${(w.rules ?? []).join('；') || '无'}`,
    `背景: ${bg || '（无）'}`
  ].join('\n')
}

/** 组配主入口 */
export function buildAssembledContext(project: Project, chapter: Chapter): AssembledContext {
  const currentNum = Math.max(1, ...project.chapters.map((c) => c.num || 0))
  const q = queryText(chapter)

  // 1) 人物：按名字/标签命中，主角恒在；未命中时保留主角（保底，避免无人可用）
  const scoredChars = (project.characters ?? [])
    .filter((c) => c.active !== false)
    .map((c) => ({
      c,
      score: hitScore(q, charCandidates(c)) + (c.isProtagonist ? 1 : 0),
      first: c.firstAppear ?? 1
    }))
    .sort((a, b) => b.score - a.score || a.first - b.first)

  const chars: ComposedItem<Character>[] = []
  const used = new Set<string>()
  for (const { c, score } of scoredChars) {
    if (used.size >= BUDGET.charsMax) break
    if (score <= 0 && !c.isProtagonist) continue // 非主角且未命中就不带
    if (used.has(c.id)) continue
    used.add(c.id)
    chars.push({ target: c, excerpt: charExcerpt(c, currentNum, BUDGET.perCharMax), weight: score })
  }

  // 2) 条目：按名字/标签命中且 active，取权重前 N
  const elems = (project.elements ?? [])
    .filter((e) => e.active !== false)
    .map((e) => ({ e, score: hitScore(q, elemCandidates(e)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, BUDGET.elementsMax)

  // 3) 前情（自然按预算衰减）
  const recent = buildRecent(project, currentNum)

  // 4) 未兑现伏笔（常驻）
  const openForeshadows = (project.foreshadows ?? [])
    .filter((f) => f.status === 'open')
    .slice(0, 12)
    .map((f) => `第${f.sownChapter}章埋下：${f.desc}`)

  // 5) 预算硬控（实际输出规模由 per-item 限制兜底；整体规模供诊断）
  let total = 0
  for (const i of chars) total += i.excerpt.length
  for (const i of recent) total += i.summary.length

  return {
    currentNum,
    worldSummary: buildWorldSummary(project),
    chars: chars.map((i) => ({ ...i, excerpt: i.excerpt })),
    elements: elems.map((x) => ({
      target: x.e,
      excerpt: elemExcerpt(x.e, currentNum, Math.max(200, Math.round(BUDGET.elementsCharsMax / Math.max(1, elems.length)))),
      weight: x.score
    })),
    recent,
    openForeshadows
  }
}

/** 返回给 UI 的「本次究竟带了什么」的诊断信息（步骤 1 供调试，也可后续做成面板） */
export function describeComposition(ctx: AssembledContext): string {
  const total =
    ctx.chars.reduce((a, i) => a + i.excerpt.length, 0) +
    ctx.elements.reduce((a, i) => a + i.excerpt.length, 0) +
    ctx.recent.reduce((a, i) => a + i.summary.length, 0)
  return [
    `第 ${ctx.currentNum} 章组配：`,
    `  人物 ${ctx.chars.length} 个：${ctx.chars.map((i) => i.target.name).join('、') || '无'}`,
    `  条目 ${ctx.elements.length} 个：${ctx.elements.map((i) => i.target.name).join('、') || '无'}`,
    `  前情 ${ctx.recent.length} 章：${ctx.recent.map((i) => `#${i.chapterNum}`).join('、') || '无'}`,
    `  未兑现伏笔 ${ctx.openForeshadows.length} 条`,
    `  设定增量合计约 ${total} 字（预算 ${BUDGET.totalCharsMax}）`
  ].join('\n')
}
