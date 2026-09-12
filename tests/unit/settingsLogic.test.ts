import { describe, expect, it } from 'vitest'
import { resolveLibraryRoot } from '../../src/shared/settingsLogic'

// shared/settingsLogic：库根决策链（真机 settings.libraryRoot 与 devShim getPaths 共用，2026-09-12）
// 锁住分支：设置非空 → 老默认位（存在且非空）→ 工作区/项目库。
describe('resolveLibraryRoot（与真机 libraryRoot 决策链同口径）', () => {
  it('设置非空 → 用设置值（trim）', () => {
    expect(resolveLibraryRoot({
      configured: '  /tmp/我的库  ', legacyPath: '/L', workspaceDefault: '/W', legacyExists: true
    })).toBe('/tmp/我的库')
  })

  it('设置为空 + legacy 存在 → 老默认位', () => {
    expect(resolveLibraryRoot({
      configured: '', legacyPath: '/Users/USER/Documents/织卷项目库', workspaceDefault: '/Users/USER/Documents/织卷工作区', legacyExists: true
    })).toBe('/Users/USER/Documents/织卷项目库')
  })

  it('设置为空 + legacy 不存在 → 工作区/项目库', () => {
    expect(resolveLibraryRoot({
      configured: undefined, legacyPath: '/L', workspaceDefault: '/Users/USER/Documents/织卷工作区', legacyExists: false
    })).toBe('/Users/USER/Documents/织卷工作区/项目库')
  })

  it('设置只含空白 → 视同未设置', () => {
    expect(resolveLibraryRoot({
      configured: '   ', legacyPath: '/L', workspaceDefault: '/W', legacyExists: false
    })).toBe('/W/项目库')
  })

  it('workspaceDefault 带尾斜线时不产生双斜线', () => {
    expect(resolveLibraryRoot({
      configured: null, legacyPath: '/L', workspaceDefault: '/W/', legacyExists: false
    })).toBe('/W/项目库')
  })
})
