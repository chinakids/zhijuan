import { describe, expect, it } from 'vitest'
import { buildDiffView, DIFF_CTX } from '../../src/renderer/src/features/editor/diffView'

const base = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'].join('\n')

describe('diffView（正文版本历史·行级 diff 视图）', () => {
  it('相同文本：空 rows、无增删、不截断', () => {
    const v = buildDiffView(base, base)
    expect(v.rows).toHaveLength(0)
    expect(v.del).toBe(0)
    expect(v.ins).toBe(0)
    expect(v.truncated).toBe(false)
  })

  it('单行替换：−行 +行，且带前后上下文', () => {
    const v = buildDiffView(base, base.replace('L5', 'X5'))
    expect(v.del).toBe(1)
    expect(v.ins).toBe(1)
    expect(v.rows.filter((r) => r.kind === 'del').map((r) => r.text)).toEqual(['L5'])
    expect(v.rows.filter((r) => r.kind === 'ins').map((r) => r.text)).toEqual(['X5'])
    // 上下文行：L3/L4 与 L6/L7（ctx=2），L1/L2/L8/L9/L10 被省
    expect(v.rows.filter((r) => r.kind === 'eq').map((r) => r.text)).toEqual(['L3', 'L4', 'L6', 'L7'])
  })

  it('两处远距修改：中间上下文被省略并计数', () => {
    let s = base
    s = s.replace('L2', 'A2')
    s = s.replace('L9', 'B9')
    const v = buildDiffView(base, s)
    const skipped = v.rows.find((r) => r.skipped !== undefined)
    expect(skipped).toBeDefined()
    expect(skipped!.skipped).toBeGreaterThan(0)
    // 变化行都在
    expect(v.rows.filter((r) => r.kind === 'del').map((r) => r.text)).toEqual(['L2', 'L9'])
    expect(v.rows.filter((r) => r.kind === 'ins').map((r) => r.text)).toEqual(['A2', 'B9'])
  })

  it('纯新增几行：只有 ins，无 del', () => {
    const next = base.split('\n').map((l, i) => (i === 4 ? l + '\nNEW1' : l)).join('\n')
    const v = buildDiffView(base, next)
    expect(v.del).toBe(0)
    expect(v.ins).toBe(1)
    expect(v.rows.find((r) => r.kind === 'ins')?.text).toBe('NEW1')
  })

  it('空 vs 非空：全部行记 ins', () => {
    const v = buildDiffView('', 'a\nb\nc\n')
    expect(v.del).toBe(0)
    expect(v.ins).toBe(3)
    expect(v.rows.filter((r) => r.kind === 'ins')).toHaveLength(3)
  })

  it('超出 maxRows：截断并报 truncated', () => {
    const v = buildDiffView(base, base.replace('L5', 'X5'), DIFF_CTX, 3)
    expect(v.truncated).toBe(true)
    expect(v.rows.length).toBeLessThanOrEqual(3)
    // 尾部省略计数会并进最后一行
    expect(v.rows.length).toBe(3)
  })
})
