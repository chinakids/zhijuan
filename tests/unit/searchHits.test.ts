import { describe, it, expect } from 'vitest'
import { finalizeSearchHits, SEARCH_DEFAULT_LIMIT } from '../../src/shared/searchHits'
import type { SearchHit } from '../../src/shared/types'

function hit(name: string, mtime: number): SearchHit {
  return { file: `素材库/${name}.md`, name, mtime, field: 'content', snippet: '' }
}

describe('finalizeSearchHits（mtime 排序 + 截断，真机/devShim 同口径）', () => {
  it('按 mtime 新→旧排序', () => {
    const out = finalizeSearchHits([hit('a', 100), hit('b', 300), hit('c', 200)], 10)
    expect(out.map((h) => h.name)).toEqual(['b', 'c', 'a'])
  })
  it('截断保留最新 N 条（旧实现先截断后排序会把最新挤出）', () => {
    const out = finalizeSearchHits([hit('a', 100), hit('b', 300), hit('c', 200)], 1)
    expect(out.map((h) => h.name)).toEqual(['b'])
  })
  it('limit<=0 视为不截断', () => {
    const out = finalizeSearchHits([hit('a', 100), hit('b', 300)], 0)
    expect(out).toHaveLength(2)
    const out2 = finalizeSearchHits([hit('a', 100)], -1)
    expect(out2).toHaveLength(1)
  })
  it('mtime 相同时保持枚举序（稳定排序）', () => {
    const out = finalizeSearchHits([hit('a', 200), hit('b', 200)], 5)
    expect(out.map((h) => h.name)).toEqual(['a', 'b'])
  })
  it('默认 limit 恒为 50（真机契约）', () => {
    expect(SEARCH_DEFAULT_LIMIT).toBe(50)
  })
  it('不修改入参（纯函数）', () => {
    const src = [hit('a', 100), hit('b', 300)]
    finalizeSearchHits(src, 1)
    expect(src.map((h) => h.name)).toEqual(['a', 'b'])
  })
})
