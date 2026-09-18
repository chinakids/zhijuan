import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-settingspane-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, '文档') }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) },
  shell: {}
}))

import { readSettings, setSettings, getSettings } from '../../src/main/settings'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

describe('settingsPane（设置页分区记忆：键/默认/迁移；HIG Settings「Restore the most recently viewed pane」）', () => {
  it('默认落在 workspace（首开回到第一分区）', () => {
    expect(DEFAULT_SETTINGS.settingsPane).toBe('workspace')
  })

  it('迁移：旧设置文件缺 settingsPane → readSettings 合并 DEFAULT 回落默认（老用户升级不丢其它设置）', () => {
    mkdirSync(holder.userData, { recursive: true })
    writeFileSync(
      join(holder.userData, 'zhijuan-settings.json'),
      JSON.stringify({ workspace: '/old', theme: 'dark', foldedCols: { novel: true, characters: false, worldview: false, outline: false, library: false } }),
      'utf-8'
    )
    const s = readSettings()
    expect(s.settingsPane).toBe('workspace')
    expect(s.theme).toBe('dark')
    expect(s.foldedCols.novel).toBe(true)
  })

  it('浅合并写读一致：patch settingsPane 不改其它键', () => {
    setSettings({ settingsPane: 'engine' })
    expect(getSettings().settingsPane).toBe('engine')
    expect(getSettings().theme).toBe('paper')
  })

  it('写读一致：getSettings 原样返回持久化值', () => {
    setSettings({ settingsPane: 'look' })
    expect(getSettings().settingsPane).toBe('look')
  })
})
