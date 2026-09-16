// 织卷 S4 · 提案 errMap 纯逻辑（创作层 2026-09-17：失败红字跨抽屉开合保留）
import { describe, expect, it } from 'vitest'
import { pruneErrMap, setErrInto } from '../../src/renderer/src/store/proposalErr'

describe('setErrInto（失败红字写入/清除）', () => {
  it('写入错误 → 新 map 含该提案，原 map 不变', () => {
    const base = { p1: '旧' }
    const next = setErrInto(base, 'p2', '系统写入失败，可直接重试')
    expect(next).toEqual({ p1: '旧', p2: '系统写入失败，可直接重试' })
    expect(base).toEqual({ p1: '旧' })
  })

  it('空串清除既有错误；无该键时原引用不变（不触发多余重渲染）', () => {
    const base = { p1: 'x' }
    expect(setErrInto(base, 'p1', '')).toEqual({})
    expect(setErrInto(base, 'p2', '')).toBe(base)
  })
})

describe('pruneErrMap（refresh 收敛剔除已消失提案的残留）', () => {
  it('列表中存在全部错误键 → 原引用不变', () => {
    const m = { p1: 'a', p2: 'b' }
    expect(pruneErrMap(m, new Set(['p1', 'p2']))).toBe(m)
  })

  it('有键不在列表 → 剔除后返回新 map（幽灵错误不存活）', () => {
    expect(pruneErrMap({ p1: 'a', p2: 'b' }, new Set(['p1']))).toEqual({ p1: 'a' })
    expect(pruneErrMap({ p1: 'a', p2: 'b' }, new Set([]))).toEqual({})
  })
})
