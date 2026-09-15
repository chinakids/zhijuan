import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncIssue } from '../../src/shared/types'
import { bulkQuickCreate } from '../../src/renderer/src/features/sync/guardBulk'
import { quickCharDocMarkdown } from '../../src/shared/charDoc'

// 与 preload Window.zhijuan 同签名的最小声明（node 单测项目不接触 preload/index.d.ts）
declare global {
  interface Window {
    zhijuan: {
      readDoc: (id: string, rel: string) => Promise<string | null>
      writeDoc: (id: string, rel: string, content: string) => Promise<boolean>
    }
  }
}

const issue = (target: string): SyncIssue => ({
  target,
  action: 'dropped',
  reason: '尚未建档',
  unfiled: true
})

const readDocMock = vi.fn()
const writeDocMock = vi.fn()

beforeEach(() => {
  readDocMock.mockReset()
  writeDocMock.mockReset()
  vi.stubGlobal('window', { zhijuan: { readDoc: readDocMock, writeDoc: writeDocMock } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guardBulk.bulkQuickCreate（写前查存在、已有档案绝不覆盖——a484204/228a0dd 核心承诺）', () => {
  it('全部不存在 → 全部 created，模板按名称写盘，无 skipped', async () => {
    readDocMock.mockResolvedValue(null)
    const r = await bulkQuickCreate('p', [issue('人物/新角色1.md'), issue('人物/新角色2.md')])
    expect(r.created).toEqual(['人物/新角色1.md', '人物/新角色2.md'])
    expect(r.skipped).toEqual([])
    expect(writeDocMock).toHaveBeenCalledTimes(2)
    expect(writeDocMock).toHaveBeenNthCalledWith(1, 'p', '人物/新角色1.md', quickCharDocMarkdown('新角色1'))
    expect(writeDocMock).toHaveBeenNthCalledWith(2, 'p', '人物/新角色2.md', quickCharDocMarkdown('新角色2'))
  })

  it('全部已存在 → 全部 skipped，writeDoc 零调用（不覆盖作者的已有档案）', async () => {
    readDocMock.mockResolvedValue('# 作者手写\n\n- 她不爱说话，但记得所有船的名字')
    const r = await bulkQuickCreate('p', [issue('人物/新角色1.md')])
    expect(r.created).toEqual([])
    expect(r.skipped).toEqual(['人物/新角色1.md'])
    expect(writeDocMock).not.toHaveBeenCalled()
  })

  it('混合 → 不存在的建、已存在的跳，互不干扰', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) =>
      rel === '人物/新角色1.md' ? Promise.resolve('作者已有档') : Promise.resolve(null)
    )
    const r = await bulkQuickCreate('p', [issue('人物/新角色1.md'), issue('人物/新角色2.md')])
    expect(r.created).toEqual(['人物/新角色2.md'])
    expect(r.skipped).toEqual(['人物/新角色1.md'])
    expect(writeDocMock).toHaveBeenCalledTimes(1)
    expect(writeDocMock).toHaveBeenCalledWith('p', '人物/新角色2.md', quickCharDocMarkdown('新角色2'))
  })

  it('非人物 target（世界观/正文）跳过：不读写、不进任何结果', async () => {
    readDocMock.mockResolvedValue(null)
    const r = await bulkQuickCreate('p', [issue('世界观/总纲.md'), issue('正文/第01章_雾港.md')])
    expect(r.created).toEqual([])
    expect(r.skipped).toEqual([])
    expect(readDocMock).not.toHaveBeenCalled()
    expect(writeDocMock).not.toHaveBeenCalled()
  })

  it('空名 / 仅前缀 target 跳过（personRelOf 判据兜底）', async () => {
    readDocMock.mockResolvedValue(null)
    const r = await bulkQuickCreate('p', [issue('人物/.md'), issue('人物/'), issue('')])
    expect(r.created).toEqual([])
    expect(r.skipped).toEqual([])
    expect(readDocMock).not.toHaveBeenCalled()
    expect(writeDocMock).not.toHaveBeenCalled()
  })

  it('无 .md 后缀的人物 target 也按归一化路径读写', async () => {
    readDocMock.mockResolvedValue(null)
    const r = await bulkQuickCreate('p', [issue('人物/张三')])
    expect(r.created).toEqual(['人物/张三'])
    expect(writeDocMock).toHaveBeenCalledWith('p', '人物/张三.md', quickCharDocMarkdown('张三'))
  })
})
