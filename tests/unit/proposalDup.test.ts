import { describe, it, expect } from 'vitest'
import { sliceItemKey, isRejectedDuplicate, dedupeRejectedSliceItems, unsettledSameOf } from '../../src/shared/proposalDup'
import type { Proposal, ProposalItem } from '../../src/shared/types'

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

describe('unsettledSameOf（未处置同款：pending 保护 / stale 恢复）', () => {
  const prop = (over: Partial<Proposal> & { status: Proposal['status'] }): Proposal => ({
    id: 'p1',
    source: 'slice-sync',
    chapter: '正文/第01章.md',
    slice: '雾港夜',
    createdAt: 1,
    items: [it2()],
    ...over
  })
  it('同章同款 pending -> pending 保护', () => {
    const m = unsettledSameOf(it2(), [prop({ status: 'pending' })])
    expect(m).toEqual({ pending: expect.objectContaining({ status: 'pending' }) })
  })
  it('仅同款 stale -> restore 恢复', () => {
    const m = unsettledSameOf(it2(), [prop({ status: 'stale' })])
    expect(m).toEqual({ restore: expect.objectContaining({ status: 'stale' }) })
  })
  it('pending 优先于 stale（并存时不恢复 stale）', () => {
    const m = unsettledSameOf(it2(), [prop({ id: 'a', status: 'stale' }), prop({ id: 'b', status: 'pending' })])
    expect(m).toEqual({ pending: expect.objectContaining({ id: 'b' }) })
  })
  it('非 slice-sync / 不同款 / 已裁决（rejected/accepted）→ null', () => {
    // 注：sameChapter 由调用方收集（createSliceProposals 里 all.filter(chapter)），函数不再筛章
    const same = [
      prop({ status: 'pending', source: 'agent-chat' }),
      prop({ status: 'pending', items: [it2({ after: '别的状态' })] }),
      prop({ status: 'rejected' }),
      prop({ status: 'accepted' })
    ]
    expect(unsettledSameOf(it2(), same)).toBeNull()
    expect(unsettledSameOf(it2(), [])).toBeNull()
  })
  it('items 多条时命中任一同款', () => {
    const p = prop({ status: 'pending', items: [it2({ after: '无关' }), it2()] })
    expect(unsettledSameOf(it2(), [p])).not.toBeNull()
  })
})
