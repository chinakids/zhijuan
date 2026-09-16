import type { Node as PMNode } from 'prosemirror-model'
import { findInDoc } from './finder'

/**
 * 每文档光标/选区位置·会话内记忆（体验层 2026-09-16；与 scrollMemory 同族）。
 *
 * 服务创作问题：切章会整棵重建编辑器（Novel `epoch`+`key`），光标/选区每次回到
 * 文档首——作者在多章往返核对伏笔/人设后要继续写，还得重新点回去（滚动位置已由
 * scrollMemory 保持，光标是收尾缺口）。平台惯例＝回到上次写/读处（Pages / TextEdit
 * / iA Writer；VS Code 编辑器会话内按文件记光标位置）。
 *
 * 口径：
 * - 模块级内存 Map，按 `projectId:rel` 记锚（与 scrollMemory 同 key、同生命周期：
 *   不落盘、不跨会话；LRU 上限 64）。
 * - 锚 = 选区 from（文本未选时即光标）前/后各 CTX 字（doc.textBetween 口径，可跨
 *   run/块）+ 选区宽与原文（非空选区校验用）。
 * - 恢复：findInDoc（与 ⌘F/批注同口径，run 内匹配）定位 before 结束点，再以
 *   textBetween 校验 after 紧跟——文本未变→精确复原；附近被改→降级仅恢复光标到
 *   before 处（该处文本仍存在）；全部找不到→不动（Apple HIG「避免打扰」）。
 * - 恢复即消费（take）；再次编辑/切走会重新保存，无基线漂移。
 */

/** 锚定上下文：光标前/后各取多少字（中文 24 字唯一性足够，且足够小不敏感） */
export const CURSOR_CTX = 24
const SEL_MAX = 200
const MAX = 64

export interface CursorAnchor {
  /** 选区起点（光标）前最多 CTX 字（textBetween 口径，块间以 \n 分隔） */
  before: string
  /** 选区起点后最多 CTX 字 */
  after: string
  /** 是否空选区（纯光标） */
  empty: boolean
  /** 选区宽（空选区=0） */
  len: number
  /** 选区原文（非空选区时保存，恢复校验；截断到 SEL_MAX） */
  sel?: string
  /** 原 from 位置提示：重复文本（模板化段落）多候选时选距离最近的（文档被改时仍是最佳启发） */
  pos?: number
}

const mem = new Map<string, CursorAnchor>()

export function saveCursor(key: string, anchor: CursorAnchor): void {
  if (mem.has(key)) mem.delete(key)
  mem.set(key, anchor)
  while (mem.size > MAX) {
    const k = mem.keys().next().value
    if (k === undefined) break
    mem.delete(k)
  }
}

/** 读取并消费（删除）。恢复失败/无记忆返回 undefined；再次编辑会重新保存。 */
export function takeCursor(key: string): CursorAnchor | undefined {
  const v = mem.get(key)
  mem.delete(key)
  return v
}

/** 无头冒烟/诊断可观测性（只读快照） */
export function cursorMemorySnapshot(): Array<[string, CursorAnchor]> {
  return [...mem.entries()]
}

/** 由 PM 坐标构造锚（from=选区起点/光标位；空文档返回 null）。纯函数，可单测。 */
export function anchorFromPos(doc: PMNode, from: number, to: number): CursorAnchor | null {
  const size = doc.content.size
  if (size <= 0) return null
  const f = Math.max(0, Math.min(from, size))
  const tt = Math.max(f, Math.min(to, size))
  const before = doc.textBetween(Math.max(0, f - CURSOR_CTX), f, '\n')
  const after = doc.textBetween(f, Math.min(size, f + CURSOR_CTX), '\n')
  if (!before && !after) return null // 文档无任何文本（空段落）——空锚恢复也是 no-op
  const empty = tt === f
  const len = tt - f
  return {
    before,
    after,
    empty,
    len,
    sel: empty ? undefined : doc.textBetween(f, tt, '\n').slice(0, SEL_MAX),
    pos: f
  }
}

/** 恢复：返回要设置的选区 `{from,to}`（纯函数，不动视图）；找不到返回 null。 */
export function restoreCursorSelection(doc: PMNode, a: CursorAnchor): { from: number; to: number } | null {
  const size = doc.content.size
  if (size <= 0) return null
  // ① 主路径：before 定位（run 内匹配）+ after 紧跟校验（textBetween 可跨 run/块）
  //    ——文本未变即精确复原；模板化段落（重复文本）多候选时以原 pos 提示选最近的（防「回错段」）。
  if (a.before) {
    const hits = findInDoc(doc, a.before)
    const ok: number[] = []
    for (const h of hits) {
      const p = h.to
      if (a.after && doc.textBetween(p, Math.min(size, p + a.after.length), '\n') !== a.after) continue
      ok.push(p)
    }
    if (ok.length) return selectAt(doc, pickClosest(ok, a), a)
    // ② 降级：光标附近被改（after 失配）——before 文本仍存在，恢复光标到其结束处（≈原位置）
    if (hits.length) return selectAt(doc, pickClosest(hits.map((h) => h.to), a), a)
  }
  // ③ 锚在文档首（before 为空）：用 after 定位，光标落在 after 起点
  if (a.after) {
    const hits = findInDoc(doc, a.after)
    if (hits.length) return selectAt(doc, pickClosest(hits.map((h) => h.from), a), a)
  }
  return null
}

/** 有原位置提示时选最近的候选（重复文本场景回对段）；无提示取第一个。 */
function pickClosest(cands: number[], a: CursorAnchor): number {
  if (a.pos === undefined || !cands.length) return cands[0]
  let best = cands[0]
  let bestD = Math.abs(best - a.pos)
  for (const c of cands) {
    const d = Math.abs(c - a.pos)
    if (d < bestD) { best = c; bestD = d }
  }
  return best
}

function selectAt(doc: PMNode, p: number, a: CursorAnchor): { from: number; to: number } {
  if (a.empty || a.len <= 0) return { from: p, to: p }
  const size = doc.content.size
  const to = Math.min(p + a.len, size)
  // 非空选区：原文校验一致才恢复选区；已变（尤其长选区）→ 降级光标，避免误选
  if (a.sel !== undefined && doc.textBetween(p, to, '\n') === a.sel) return { from: p, to }
  return { from: p, to: p }
}
