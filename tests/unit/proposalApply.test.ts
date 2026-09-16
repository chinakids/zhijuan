import { describe, expect, it } from 'vitest'
import { isIoFailure } from '../../src/shared/proposalApply'

// 提案 apply 失败分类（2026-09-16 候选1）：内容校验错误（无 code）≠ 系统/IO 错误（Node fs 带 code）
describe('isIoFailure（提案失败分类判定权威源）', () => {
  it('Node 系统错误（带 code）→ true', () => {
    expect(isIoFailure(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }))).toBe(true)
    expect(isIoFailure({ code: 'EACCES', message: 'permission denied' })).toBe(true)
    expect(isIoFailure({ code: 'ENOSPC' })).toBe(true)
  })

  it('业务校验错误（无 code）→ false', () => {
    expect(isIoFailure(new Error('replace-text 缺少 before 文段'))).toBe(false)
    expect(isIoFailure(new Error('原文段已变（可能被手动编辑），请人工确认'))).toBe(false)
  })

  it('空/非对象/无 code 字段 → false', () => {
    expect(isIoFailure(null)).toBe(false)
    expect(isIoFailure(undefined)).toBe(false)
    expect(isIoFailure('boom')).toBe(false)
    expect(isIoFailure(42)).toBe(false)
    expect(isIoFailure({})).toBe(false)
    expect(isIoFailure({ message: 'x' })).toBe(false)
    expect(isIoFailure({ code: '' })).toBe(false)
  })
})
