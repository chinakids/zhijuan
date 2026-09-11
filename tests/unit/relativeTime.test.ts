import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../../src/shared/relativeTime'

describe('formatRelativeTime（shared 纯逻辑）', () => {
  const now = 1_800_000_000_000 // 固定参考点
  const min = 60_000
  const hour = 3_600_000
  const day = 86_400_000

  it('分钟级：刚刚 / N 分钟前 / N 小时前边界', () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 59_000, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 分钟前')
    expect(formatRelativeTime(now - 59 * min, now)).toBe('59 分钟前')
    expect(formatRelativeTime(now - hour, now)).toBe('1 小时前')
    expect(formatRelativeTime(now - 23 * hour, now)).toBe('23 小时前')
  })

  it('天级：N 天前（<7 天）', () => {
    expect(formatRelativeTime(now - day, now)).toBe('1 天前')
    expect(formatRelativeTime(now - 6 * day, now)).toBe('6 天前')
  })

  it('≥7 天显示 MM-DD', () => {
    expect(formatRelativeTime(now - 7 * day, now)).toMatch(/^\d{2}-\d{2}$/)
    expect(formatRelativeTime(now - 300 * day, now)).toMatch(/^\d{2}-\d{2}$/)
    // 固定输入可断言具体值：2027-01-15 距今 300 天 → 03-21
    const ref = new Date('2027-01-15T12:00:00+08:00').getTime()
    expect(formatRelativeTime(ref - 300 * day, ref)).toBe('03-21')
  })

  it('非法输入返回空串', () => {
    expect(formatRelativeTime(0, now)).toBe('')
    expect(formatRelativeTime(Number.NaN, now)).toBe('')
    expect(formatRelativeTime(-1, now)).toBe('')
  })
})
