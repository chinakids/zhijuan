import { describe, expect, it } from 'vitest'
import { lineBoundaryPos } from '../../src/renderer/src/features/editor/macTextKeys'

/** 构造 coordAt：两行文档，pos 0..11 在第一行(top=100)，12..20 在第二行(top=120)。
 * textblock 边界假设：0=第二段? 简化：整 doc 0..20 视为单一 textblock（长段软换行为两行）。 */
const tops: Record<number, number> = {}
for (let i = 0; i <= 11; i++) tops[i] = 100
for (let i = 12; i <= 20; i++) tops[i] = 120
const coordAt = (p: number) => (p in tops ? { top: tops[p] } : null)
const BLOCK_START = 0
const BLOCK_END = 20

describe('lineBoundaryPos（mac Cmd+←/→ 行级边界扫描，限 textblock 内）', () => {
  it('dir=1 停在当前行尾', () => {
    expect(lineBoundaryPos(8, 1, BLOCK_START, BLOCK_END, coordAt)).toBe(11)
    expect(lineBoundaryPos(14, 1, BLOCK_START, BLOCK_END, coordAt)).toBe(20)
  })
  it('dir=-1 停在当前行首', () => {
    expect(lineBoundaryPos(8, -1, BLOCK_START, BLOCK_END, coordAt)).toBe(0)
    expect(lineBoundaryPos(14, -1, BLOCK_START, BLOCK_END, coordAt)).toBe(12)
  })
  it('已在边界时不越界（行首/行尾幂等）', () => {
    expect(lineBoundaryPos(0, -1, BLOCK_START, BLOCK_END, coordAt)).toBe(0)
    expect(lineBoundaryPos(20, 1, BLOCK_START, BLOCK_END, coordAt)).toBe(20)
  })
  it('textblock 内部扫描不越过 blockStart/blockEnd（跨段防护）', () => {
    // 模拟：段边界 5..12（段内 5..11 top=100，段外 12..14 top=120（另一段））
    const seg = (p: number) => ({ top: p <= 9 ? 100 : 120 })
    expect(lineBoundaryPos(8, 1, 5, 9, seg)).toBe(9) // 不越段尾 9
    expect(lineBoundaryPos(8, -1, 5, 9, seg)).toBe(5) // 不越段首 5
  })
  it('同 top 亚像素差（行内排版抖动）不误断行', () => {
    const jitter = (p: number) => ({ top: p <= 11 ? 100.4 : 120.3 })
    expect(lineBoundaryPos(10, 1, BLOCK_START, BLOCK_END, jitter)).toBe(11)
    expect(lineBoundaryPos(13, -1, BLOCK_START, BLOCK_END, jitter)).toBe(12)
  })
  it('coordAt 不可用（空段/异常）时原样返回', () => {
    expect(lineBoundaryPos(5, 1, BLOCK_START, BLOCK_END, () => null)).toBe(5)
  })
  it('空 textblock（start=end）原样返回', () => {
    expect(lineBoundaryPos(5, 1, 5, 5, () => ({ top: 0 }))).toBe(5)
  })
})
