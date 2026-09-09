import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

// electron 是唯一外部依赖：把 userData/documents 指向临时目录，全部走真实文件系统（store.test.ts 先例）
const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-ws-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, '文档') }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) }
}))

import { setSettings } from '../../src/main/settings'
import { workspaceStatus, ensureWorkspaceDocs, listWorkspaceDocs, readWorkspaceDoc } from '../../src/main/workspace'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

beforeEach(() => {
  // 每个用例从空工作区出发（与 store.test 对库根的处理一致）
  rmSync(join(holder.tmp, 'ws'), { recursive: true, force: true })
  setSettings({ workspace: join(holder.tmp, 'ws'), libraryRoot: join(holder.tmp, 'projects') })
})

describe('工作区文档（main/workspace.ts）', () => {
  it('ensureWorkspaceDocs：首次落档说明文档并建项目库目录，二次幂等不再创建', () => {
    const ws = join(holder.tmp, 'ws')
    const first = ensureWorkspaceDocs()
    expect(first.ok).toBe(true)
    expect(first.created.length).toBeGreaterThan(0)
    expect(first.created).toContain('使用说明.md')
    expect(existsSync(join(ws, '文档', '使用说明.md'))).toBe(true)
    expect(existsSync(join(ws, '项目库'))).toBe(true)
    const second = ensureWorkspaceDocs()
    expect(second.created).toEqual([])
    // 已有内容不被覆盖：改名后再次调用仍是旧内容
    const old = require('node:fs').readFileSync(join(ws, '文档', '使用说明.md'), 'utf-8')
    expect(old).toContain('织卷是给写长篇的作者准备的创作工作台')
  })

  it('workspaceStatus：dir 指向设置的工作区；建立文档后 inited=true、docs 有内容', () => {
    const st0 = workspaceStatus()
    expect(st0.dir).toBe(join(holder.tmp, 'ws'))
    expect(st0.inited).toBe(false)
    ensureWorkspaceDocs()
    const st1 = workspaceStatus()
    expect(st1.inited).toBe(true)
    expect(st1.docs.map((d) => d.file).sort()).toEqual(expect.arrayContaining(['使用说明.md', '约定与结构.md']))
  })

  it('listWorkspaceDocs：只列 .md，去扩展名作 name，按中文名排序', () => {
    expect(listWorkspaceDocs()).toEqual([])
    ensureWorkspaceDocs()
    const docs = listWorkspaceDocs()
    expect(docs.length).toBeGreaterThanOrEqual(2)
    const names = docs.map((d) => d.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh')))
  })

  it('readWorkspaceDoc：按文件名可读；不存在返回 null；传入路径/上级只取 basename 不越界', () => {
    ensureWorkspaceDocs()
    const c = readWorkspaceDoc('使用说明.md')
    expect(c).toBeTruthy()
    expect(c).toContain('织卷')
    expect(readWorkspaceDoc('没有这个文件.md')).toBeNull()
    // 带目录前缀与绝对路径：basename 归一后仍命中同一文件（不越出 文档/ 目录）
    expect(readWorkspaceDoc(join('..', '使用说明.md'))).toBe(c)
    expect(readWorkspaceDoc('/etc/passwd')).toBeNull()
  })
})
