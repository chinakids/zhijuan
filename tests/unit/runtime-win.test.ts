import { describe, it, expect, vi } from 'vitest'

// runtime.ts 顶层只 import electron 的 app（未在模块顶层调用）——mock 提供最小面即可
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/zj-fake-app',
    getPath: () => '/tmp/zj-fake-userdata'
  }
}))

import { winNodeBinCandidateList } from '../../src/main/agent/runtime'

describe('winNodeBinCandidateList（win 上系统 node 候选路径拼接与优先级）', () => {
  it('APPDATA 存在 → nvm 根=%APPDATA%\\nvm\\versions\\node，版本点按传入顺序（优先级）', () => {
    const list = winNodeBinCandidateList({ APPDATA: 'C:\\Users\\kk\\AppData\\Roaming' }, 'C:\\Users\\kk', [
      'v20.11.1',
      'v22.14.0'
    ])
    expect(list[0]).toBe('C:\\Users\\kk\\AppData\\Roaming\\nvm\\versions\\node\\v20.11.1\\node.exe')
    expect(list[1]).toBe('C:\\Users\\kk\\AppData\\Roaming\\nvm\\versions\\node\\v22.14.0\\node.exe')
  })

  it('APPDATA 缺失 → nvm 根回退 homedir（与 nodeBin 里 readdirSync 同一 fallback 口径）', () => {
    const list = winNodeBinCandidateList({}, 'C:\\Users\\kk', ['v22.14.0'])
    expect(list[0]).toBe('C:\\Users\\kk\\nvm\\versions\\node\\v22.14.0\\node.exe')
  })

  it('Program Files 两位恒为末位（nvm 未装时的系统位），x86 在 64 位之后', () => {
    const list = winNodeBinCandidateList({}, 'C:\\Users\\kk', [])
    expect(list).toEqual([
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe'
    ])
  })

  it('候选总数 = versions 数 + 2（任何入参形态下结构稳定）', () => {
    const list = winNodeBinCandidateList({ APPDATA: 'C:\\Users\\kk\\AppData\\Roaming' }, 'C:\\Users\\kk', [
      'v18.0.0'
    ])
    expect(list.length).toBe(3)
    expect(list.every((p) => p.endsWith('node.exe'))).toBe(true)
  })
})
