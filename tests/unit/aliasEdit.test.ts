import { describe, expect, it } from 'vitest'
import { aliasEditFor } from '../../src/shared/aliasEdit'

describe('aliasEditFor（称谓类转提案的别名登记可执行变更）', () => {
  const fmOnly = '---\n姓名: 陈默\n身份: 修理工\n---'
  const withAlias = '---\n姓名: 陈默\n别名: [沈爷]\n身份: 修理工\n---'

  it('adds 去重/去空白/长度<2 过滤', () => {
    const raw = fmOnly + '\n\n正文。'
    const e = aliasEditFor(raw, [' 陈师傅 ', '陈师傅', '老', ''])
    expect(e!.after).toBe('姓名: 陈默\n别名: [陈师傅]')
  })

  it('无「别名:」行：在「姓名: X」行后插入宿主约定头', () => {
    const raw = fmOnly + '\n\n# 陈默\n\n正文不用动。'
    const e = aliasEditFor(raw, ['陈师傅', '老陈'])
    expect(e).not.toBeNull()
    expect(e!.before).toBe('姓名: 陈默')
    expect(e!.after).toBe('姓名: 陈默\n别名: [陈师傅, 老陈]')
  })

  it('已有「别名: [沈爷]」：合并去重并保序', () => {
    const raw = withAlias + '\n\n正文。'
    const e = aliasEditFor(raw, ['老陈', '沈爷', '陈师傅'])
    expect(e!.before).toBe('别名: [沈爷]')
    expect(e!.after).toBe('别名: [沈爷, 老陈, 陈师傅]')
  })

  it('已有别名且全部已登记：无变更（返回 null）', () => {
    const e = aliasEditFor(withAlias, ['沈爷'])
    expect(e).toBeNull()
  })

  it('别名行非数组风格（单值）：不猜、回退 null', () => {
    const raw = '---\n姓名: 陈默\n别名: 沈爷\n---'
    expect(aliasEditFor(raw, ['陈师傅'])).toBeNull()
  })

  it('无约定头：回退 null；空 adds：回退 null；长度 <2：回退 null', () => {
    expect(aliasEditFor('没有约定头\n正文', ['陈师傅'])).toBeNull()
    expect(aliasEditFor(fmOnly, [])).toBeNull()
    expect(aliasEditFor(fmOnly, ['陈'])).toBeNull()
  })

  it('using replace 语义：before 在原文唯一存在，替换后不误伤正文', () => {
    const raw = '---\n姓名: 陈默\n身份: 修理工\n---\n\n# 陈默\n\n陈默走进码头。姓名: 陈默 又在正文出现。'
    const e = aliasEditFor(raw, ['陈师傅'])
    expect(e!.before).toBe('姓名: 陈默')
    expect(raw.replace(e!.before, e!.after).startsWith('---\n姓名: 陈默\n别名: [陈师傅]\n')).toBe(true)
  })
})
