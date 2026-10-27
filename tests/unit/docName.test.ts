import { describe, expect, it } from 'vitest'
import { nextFreeName } from '../../src/shared/docName'

describe('nextFreeName（新建档案同名查重）', () => {
  it('空闲名字原样返回', () => {
    expect(nextFreeName('借书卡', () => false)).toBe('借书卡')
  })
  it('同名已占用 → 「名字 2」；再占用 → 「名字 3」', () => {
    const used = new Set(['借书卡'])
    expect(nextFreeName('借书卡', (n) => used.has(n))).toBe('借书卡 2')
    used.add('借书卡 2')
    expect(nextFreeName('借书卡', (n) => used.has(n))).toBe('借书卡 3')
  })
  it('原名字空闲时不受带序号同名干扰', () => {
    const used = new Set(['借书卡 2'])
    expect(nextFreeName('借书卡', (n) => used.has(n))).toBe('借书卡')
  })
  it('同名序号占满时回落时间戳后缀（仍不与「名字 N」撞车）', () => {
    const taken = (n: string) => /^同名( \d+)?$/.test(n)
    const got = nextFreeName('同名', taken)
    expect(got.startsWith('同名 ')).toBe(true)
    expect(taken(got)).toBe(false)
  })
})