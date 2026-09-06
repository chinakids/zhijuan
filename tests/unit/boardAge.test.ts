import { describe, expect, it } from 'vitest'
import { isBoardStale, STALE_TOLERANCE_MS } from '../../src/shared/boardAge'

describe('isBoardStale（导演板是否比正文更旧）', () => {
  const H = 3600_000

  it('导演板比正文旧得多 → 偏旧', () => {
    expect(isBoardStale(Date.now() - 86400_000, Date.now())).toBe(true)
  })

  it('导演板比正文新 → 不偏旧（正文在导完之后又改了才算）', () => {
    expect(isBoardStale(Date.now(), Date.now() - H)).toBe(false)
  })

  it('两者几乎同时（同一轮操作）→ 不偏旧，受容差保护', () => {
    const t = Date.now()
    expect(isBoardStale(t, t + 1000)).toBe(false)
    expect(isBoardStale(t, t + STALE_TOLERANCE_MS)).toBe(false)
    expect(isBoardStale(t, t + STALE_TOLERANCE_MS + 1)).toBe(true)
  })

  it('容差可显式覆盖（更苛刻）', () => {
    expect(isBoardStale(Date.now() - H, Date.now(), 60_000)).toBe(true)
    expect(isBoardStale(Date.now(), Date.now() - 30_000, 60_000)).toBe(false)
  })
})
