// 织卷 · 提案「锚点小节」提取（接受时一致性校验的共用实现，2026-09-20 候选 3 过时风险）
// 生成端（createSliceProposals）写 beforeExact 基线、接受端（applyAnchor）做漂移校验，
// 两处都从这里取「该节标题之下、下一个同级/更高级标题之前」的正文——与 applyAnchor 的
// 替换范围同构（同一提取逻辑，防写入范围漂移：替换时覆盖的正是这里提取的内容）。
import { findAnchorLine, normalizeAnchor } from './anchor'

export interface SectionExtract {
  /** 锚点节是否存在 */
  found: boolean
  /** 节正文（不含标题行；首尾空白/空行 trim；空节=空串） */
  body: string
}

/**
 * 提取锚点小节的正文。锚点归一化规则与 applyAnchor 完全一致（shared/anchor）。
 * 返回 {found:false} = 该节不存在（锚点为空或未命中）。
 */
export function extractSectionBody(text: string, anchorRaw: string): SectionExtract {
  const anchor = normalizeAnchor(anchorRaw || '')
  if (!anchor) return { found: false, body: '' }
  const lines = text.split('\n')
  const hit = findAnchorLine(lines, anchor)
  if (!hit) return { found: false, body: '' }
  let end = lines.length
  for (let i = hit.line + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= hit.level) {
      end = i
      break
    }
  }
  return { found: true, body: lines.slice(hit.line + 1, end).join('\n').trim() }
}
