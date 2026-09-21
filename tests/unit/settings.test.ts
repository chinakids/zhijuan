import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-settings-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, '文档') }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) },
  shell: {}
}))

import { normalizeSettings, readSettings, setSettings, workspaceDir, libraryRoot } from '../../src/main/settings'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

describe('normalizeSettings（老设置平滑迁移）', () => {
  it('扁平 llm 迁移成 providers.local', () => {
    const out = normalizeSettings({ llm: { baseUrl: 'http://x', model: 'm1', apiKey: 'k' } } as never)
    expect(out.llm.active).toBe('local')
    expect(out.llm.providers.local).toEqual({ baseUrl: 'http://x', model: 'm1', apiKey: 'k' })
  })

  it('删除废弃的 agentEngine 字段', () => {
    const out = normalizeSettings({ llm: { active: 'deepseek', providers: {} }, agentEngine: 'dsh' } as never)
    expect(out).not.toHaveProperty('agentEngine')
  })

  it('已知厂商 active 保留；未知值回落到 local', () => {
    expect(normalizeSettings({ llm: { active: 'glm', providers: {} } } as never).llm.active).toBe('glm')
    expect(normalizeSettings({ llm: { active: '老板牌', providers: {} } } as never).llm.active).toBe('local')
  })
})

describe('readSettings 缺省合并（增量 4b 口径：老配置无 writingInsightsEnabled → 默认 false）', () => {
  it('老配置文件（无该字段）→ 合并 DEFAULT_SETTINGS 后为 false', () => {
    // 模拟 4b 之前的老配置：只有 workspace/libraryRoot/theme，无 writingInsightsEnabled
    mkdirSync(holder.userData, { recursive: true })
    writeFileSync(
      join(holder.userData, 'zhijuan-settings.json'),
      JSON.stringify({ workspace: '', libraryRoot: '', theme: 'paper' })
    )
    expect(readSettings().writingInsightsEnabled).toBe(false)
  })

  it('显式开启 → 保留 true（读盘不回退默认）', () => {
    writeFileSync(
      join(holder.userData, 'zhijuan-settings.json'),
      JSON.stringify({ writingInsightsEnabled: true })
    )
    expect(readSettings().writingInsightsEnabled).toBe(true)
  })
})

describe('路径决策（workspaceDir / libraryRoot）', () => {
  it('workspace：设置非空优先，否则 文档/织卷工作区', () => {
    setSettings({ workspace: '/a/b' })
    expect(workspaceDir()).toBe('/a/b')
    setSettings({ workspace: '   ' })
    expect(workspaceDir()).toBe(join(holder.documents, '织卷工作区'))
    setSettings({ workspace: '' })
  })

  it('libraryRoot：设置优先；老默认位非空保持原地；全新回落 工作区/项目库', () => {
    setSettings({ libraryRoot: '/x' })
    expect(libraryRoot()).toBe('/x')
    setSettings({ libraryRoot: '', workspace: join(holder.tmp, 'ws') })
    // 全新（无遗留老库）→ 新默认
    expect(libraryRoot()).toBe(join(holder.tmp, 'ws', '项目库'))
    // 造老库后应保持原地
    const legacy = join(holder.documents, '织卷项目库')
    mkdirSync(join(legacy, '旧项目'), { recursive: true })
    expect(libraryRoot()).toBe(legacy)
    // 清理，避免影响其它用例
    setSettings({ libraryRoot: '', workspace: '' })
  })
})
