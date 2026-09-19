import { describe, it, expect } from 'vitest'
import { sliceItemKey, isRejectedDuplicate, dedupeRejectedSliceItems } from '../../src/shared/proposalDup'
import type { ProposalItem } from '../../src/shared/types'

function it2(over?: Partial<ProposalItem>): ProposalItem {
  return {
    target: '人物/沈藏.md',
    anchor: '切片：雾港夜',
    kind: 'upsert-section',
    before: '',
    after: '## 切片：雾港夜\n\n- 沈藏开始密切来往',
    reason: '动向',
    ...over
  }
}

describe('sliceItemKey（同款判定 key）', () => {
  it('全字段相同 -> key 相等', () => {
    expect(sliceItemKey(it2())).toBe(sliceItemKey(it2()))
  })
  it('锚点带 # 前缀归一 -> key 相等（同 applyAnchor 定位口径）', () => {
    const a = it2({ anchor: '# 切片：雾港夜' })
    const b = it2({ anchor: '切片：雾港夜' })
    expect(sliceItemKey(a)).toBe(sliceItemKey(b))
  })
  it('全角空格转半角 -> 与半角版本相同 key（normalizeAnchor 语义）', () => {
    expect(sliceItemKey(it2({ anchor: '切片：\u3000雾港夜' }))).toBe(sliceItemKey(it2({ anchor: '切片： 雾港夜' })))
  })
  it('锚点半角冒号（切片:）不归一 -> key 不等（与 applyAnchor 严格相等口径一致，不误判同款）', () => {
    expect(sliceItemKey(it2({ anchor: '切片: 雾港夜' }))).not.toBe(sliceItemKey(it2()))
  })
  it('after 微差/kind/target/before 不同 -> key 不等', () => {
    const base = sliceItemKey(it2())
    expect(sliceItemKey(it2({ after: '## 切片：雾港夜\n\n- 沈藏开始密切来往（变体）' }))).not.toBe(base)
    expect(sliceItemKey(it2({ kind: 'append' }))).not.toBe(base)
    expect(sliceItemKey(it2({ target: '人物/阿七.md' }))).not.toBe(base)
    expect(sliceItemKey(it2({ before: '- 旧小节' }))).not.toBe(base)
    expect(sliceItemKey(it2({ anchor: '切片：第二幕' }))).not.toBe(base)
  })
})

describe('isRejectedDuplicate', () => {
  it('同款命中', () => {
    expect(isRejectedDuplicate(it2(), [it2()])).toBe(true)
  })
  it('settled 为空/不同款不命中', () => {
    expect(isRejectedDuplicate(it2(), [])).toBe(false)
    expect(isRejectedDuplicate(it2(), [it2({ after: '## 切片：雾港夜\n\n- 别的状态' })])).toBe(false)
  })
})

describe('dedupeRejectedSliceItems', () => {
  it('混合 2 条（1 同款 1 新）-> kept 1/suppressed 1', () => {
    const { kept, suppressed } = dedupeRejectedSliceItems(
      [it2(), it2({ after: '## 切片：雾港夜\n\n- 新动向：换船票' })],
      [it2()]
    )
    expect(suppressed).toBe(1)
    expect(kept).toHaveLength(1)
    expect(kept[0].after).toContain('换船票')
  })
  it('全部同款 -> kept 0/suppressed N', () => {
    const { kept, suppressed } = dedupeRejectedSliceItems([it2(), it2()], [it2()])
    expect(suppressed).toBe(2)
    expect(kept).toHaveLength(0)
  })
})
