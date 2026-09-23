import { describe, expect, it } from 'vitest'
import { aliasEditFor } from '../../src/shared/aliasEdit'

describe('aliasEditFor（称谓类转提案的别名登记可执行变更）', () => {
  const fmOnly = '---\n姓名: 韩青\n身份: 修理工\n---'
  const withAlias = '---\n姓名: 韩青\n别名: [沈爷]\n身份: 修理工\n---'

  it('adds 去重/去空白/长度<2 过滤', () => {
    const raw = fmOnly + '\n\n正文。'
    const e = aliasEditFor(raw, [' 韩师傅 ', '韩师傅', '老', ''])
    expect(e!.after).toBe('姓名: 韩青\n别名: [韩师傅]')
  })

  it('无「别名:」行：在「姓名: X」行后插入宿主约定头', () => {
    const raw = fmOnly + '\n\n# 韩青\n\n正文不用动。'
    const e = aliasEditFor(raw, ['韩师傅', '老韩'])
    expect(e).not.toBeNull()
    expect(e!.before).toBe('姓名: 韩青')
    expect(e!.after).toBe('姓名: 韩青\n别名: [韩师傅, 老韩]')
  })

  it('已有「别名: [沈爷]」：合并去重并保序', () => {
    const raw = withAlias + '\n\n正文。'
    const e = aliasEditFor(raw, ['老韩', '沈爷', '韩师傅'])
    expect(e!.before).toBe('别名: [沈爷]')
    expect(e!.after).toBe('别名: [沈爷, 老韩, 韩师傅]')
  })

  it('已有别名且全部已登记：无变更（返回 null）', () => {
    const e = aliasEditFor(withAlias, ['沈爷'])
    expect(e).toBeNull()
  })

  it('别名行非数组风格（单值）：不猜、回退 null', () => {
    const raw = '---\n姓名: 韩青\n别名: 沈爷\n---'
    expect(aliasEditFor(raw, ['韩师傅'])).toBeNull()
  })

  it('无约定头：回退 null；空 adds：回退 null；长度 <2：回退 null', () => {
    expect(aliasEditFor('没有约定头\n正文', ['韩师傅'])).toBeNull()
    expect(aliasEditFor(fmOnly, [])).toBeNull()
    expect(aliasEditFor(fmOnly, ['陈'])).toBeNull()
  })

  it('using replace 语义：before 在原文唯一存在，替换后不误伤正文', () => {
    const raw = '---\n姓名: 韩青\n身份: 修理工\n---\n\n# 韩青\n\n韩青走进码头。姓名: 韩青 又在正文出现。'
    const e = aliasEditFor(raw, ['韩师傅'])
    expect(e!.before).toBe('姓名: 韩青')
    expect(raw.replace(e!.before, e!.after).startsWith('---\n姓名: 韩青\n别名: [韩师傅]\n')).toBe(true)
  })
})
