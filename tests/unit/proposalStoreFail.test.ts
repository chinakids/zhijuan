// 提案列表失败态（2026-10-27 可见性 P1）：读失败不再静默成空列表——
// 旧列表保留 + err 说明原因；成功一次即清 err。store 只依赖 window.zhijuan，node 环境用全局桩顶替。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Proposal } from '../../src/shared/types'
import { refreshErrMsg } from '../../src/renderer/src/store/proposalErr'

const calls = { impl: async (_id: string): Promise<Proposal[]> => [] }

let storeMod: typeof import('../../src/renderer/src/store/proposals')

function proposal(id: string): Proposal {
  return { id, status: 'pending', source: 'slice-sync', items: [] } as unknown as Proposal
}

beforeAll(async () => {
  // zustand store 只碰 window.zhijuan.listProposals
  ;(globalThis as unknown as { window: unknown }).window = {
    zhijuan: {
      listProposals: (id: string) => calls.impl(id)
    }
  }
  storeMod = await import('../../src/renderer/src/store/proposals')
})

afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window
})

beforeEach(() => {
  storeMod.useProposalStore.setState({ list: [], tick: 0, projectId: null, errMap: {}, err: '' })
  calls.impl = async () => []
})

describe('useProposalStore.refresh', () => {
  it('成功：列表落位、err 清空', async () => {
    calls.impl = async () => [proposal('p1')]
    await storeMod.useProposalStore.getState().refresh('proj-a')
    const s = storeMod.useProposalStore.getState()
    expect(s.list.map((p) => p.id)).toEqual(['p1'])
    expect(s.err).toBe('')
    expect(s.projectId).toBe('proj-a')
  })

  it('失败：保留旧列表（不清屏）+ err 写明原因，不再伪装成「没有提案」', async () => {
    calls.impl = async () => [proposal('p1'), proposal('p2')]
    await storeMod.useProposalStore.getState().refresh('proj-a')
    expect(storeMod.useProposalStore.getState().list).toHaveLength(2)

    calls.impl = async () => {
      throw new Error('EACCES: 提案目录不可读')
    }
    await storeMod.useProposalStore.getState().refresh('proj-a')
    const s = storeMod.useProposalStore.getState()
    expect(s.list.map((p) => p.id)).toEqual(['p1', 'p2']) // 旧列表仍在
    expect(s.err).toContain('读取提案失败')
    expect(s.err).toContain('EACCES')
  })

  it('失败后重试成功：err 归零', async () => {
    calls.impl = async () => {
      throw new Error('boom')
    }
    await storeMod.useProposalStore.getState().refresh('proj-a')
    expect(storeMod.useProposalStore.getState().err).toContain('boom')

    calls.impl = async () => [proposal('p9')]
    await storeMod.useProposalStore.getState().refresh('proj-a')
    const s = storeMod.useProposalStore.getState()
    expect(s.err).toBe('')
    expect(s.list.map((p) => p.id)).toEqual(['p9'])
  })

  it('切项目失败：projectId 跟着切（错误归属正确），list 不清空为幽灵旧项目数据之外的空', async () => {
    calls.impl = async () => [proposal('old')]
    await storeMod.useProposalStore.getState().refresh('proj-a')
    calls.impl = async () => {
      throw new Error('disk gone')
    }
    await storeMod.useProposalStore.getState().refresh('proj-b')
    const s = storeMod.useProposalStore.getState()
    expect(s.projectId).toBe('proj-b')
    expect(s.err).toContain('disk gone')
  })
})

describe('refreshErrMsg', () => {
  it('Error/字符串/对象/空 都能给出可读文案', () => {
    expect(refreshErrMsg(new Error('读盘失败'))).toBe('读取提案失败：读盘失败')
    expect(refreshErrMsg('字符串原因')).toBe('读取提案失败：字符串原因')
    expect(refreshErrMsg({ code: 'ENOENT' })).toBe('读取提案失败：{"code":"ENOENT"}')
    expect(refreshErrMsg(null)).toBe('读取提案失败：未知错误')
  })
})

// 防「未使用 vi」的 lint 噪音：本文件不需要 mock，显式引用一次
void vi
