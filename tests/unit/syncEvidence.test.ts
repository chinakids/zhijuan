import { describe, expect, it } from 'vitest'
import { describeSyncEvidence } from '../../src/shared/syncEvidence'

describe('describeSyncEvidence（「无设定变化」比对基准小字）', () => {
  it('无证据/空对象返回空串（调用方保持原文案）', () => {
    expect(describeSyncEvidence(undefined)).toBe('')
    expect(describeSyncEvidence(null)).toBe('')
    expect(describeSyncEvidence({ slice: '', castCount: 0, knownFiles: 0, unarchived: 0 })).toBe('')
  })
  it('正常：切片名 + 人档基数（涉及人物数不重复播报，仅作盲区参考）', () => {
    expect(describeSyncEvidence({ slice: '雾港夜', castCount: 3, knownFiles: 5, unarchived: 0 })).toBe(
      ' · 已比对 切片「雾港夜」、人档 5'
    )
  })
  it('有未建档盲区时附加「N 人未建档」', () => {
    expect(describeSyncEvidence({ slice: '雾港夜', castCount: 3, knownFiles: 5, unarchived: 2 })).toBe(
      ' · 已比对 切片「雾港夜」、人档 5、2 人未建档'
    )
  })
  it('未设切片名（硬信号）：⚠约定头未设切片名，人档仍报', () => {
    expect(describeSyncEvidence({ slice: '', castCount: 2, knownFiles: 4, unarchived: 0 })).toBe(
      ' · 已比对 ⚠约定头未设切片名、人档 4'
    )
  })
  it('正文为空被短路（未比对）：明示「正文为空，未比对」，不再报基准', () => {
    expect(
      describeSyncEvidence({ slice: '雾港夜', castCount: 1, knownFiles: 2, unarchived: 0, bodyEmpty: true })
    ).toBe(' · 正文为空，未比对')
  })
  it('切片名含特殊字符原样保留（不做转义改写）', () => {
    expect(describeSyncEvidence({ slice: '第一幕_烧杯「final」', castCount: 0, knownFiles: 3, unarchived: 0 })).toBe(
      ' · 已比对 切片「第一幕_烧杯「final」」、人档 3'
    )
  })
})
