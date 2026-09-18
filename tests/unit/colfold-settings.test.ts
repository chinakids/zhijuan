import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-colfold-'))
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

describe('foldedCols（导航列折叠态持久化：键/默认/迁移；2026-09-18 体验层）', () => {
  it('默认全展开（HIG 避免默认隐藏侧栏）', () => {
    expect(DEFAULT_SETTINGS.foldedCols).toEqual({ novel: false, characters: false, worldview: false, outline: false, library: false })
  })

  it('迁移：旧设置文件缺 foldedCols → readSettings 合并 DEFAULT 回落默认（老用户升级不丢其它设置）', () => {
    mkdirSync(holder.userData, { recursive: true })
    writeFileSync(
      join(holder.userData, 'zhijuan-settings.json'),
      JSON.stringify({ workspace: '/old', theme: 'dark', agentPanelWidth: 320 }),
      'utf-8'
    )
    const s = readSettings()
    expect(s.foldedCols).toEqual({ novel: false, characters: false, worldview: false, outline: false, library: false })
    expect(s.theme).toBe('dark')
    expect(s.agentPanelWidth).toBe(320)
  })

  it('写读一致：setSettings(全量 foldedCols) → getSettings 原样返回', () => {
    const v = { novel: true, characters: true, worldview: false, outline: true, library: false }
    setSettings({ foldedCols: v })
    expect(getSettings().foldedCols).toEqual(v)
  })

  it('浅合并语义：patch 其它键不丢 foldedCols（调用方必须传全量对象）', () => {
    setSettings({ foldedCols: { novel: false, characters: false, worldview: false, outline: false, library: false } })
    setSettings({ theme: 'paper' })
    expect(getSettings().foldedCols).toEqual({ novel: false, characters: false, worldview: false, outline: false, library: false })
    expect(getSettings().theme).toBe('paper')
  })
})
