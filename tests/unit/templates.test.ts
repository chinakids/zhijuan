import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// electron 是唯一外部依赖：把 userData/documents 指向临时目录，全部走真实文件系统（workspace.test.ts 先例）
const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-tpl-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, '文档') }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) },
  shell: { trashItem: async () => true }
}))

import { setSettings } from '../../src/main/settings'
import { ensureBuiltinTemplates, listTemplates, applyTemplate, BUILTIN_SAMPLE } from '../../src/main/templates'
import { createProject } from '../../src/main/store'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(holder.tmp, 'ws'), { recursive: true, force: true })
  rmSync(join(holder.tmp, 'projects'), { recursive: true, force: true })
  setSettings({ workspace: join(holder.tmp, 'ws'), libraryRoot: join(holder.tmp, 'projects') })
})

const ws = () => join(holder.tmp, 'ws')
const tplRoot = () => join(ws(), '模板', '项目模板')

describe('项目模板（main/templates.ts）', () => {
  it('ensureBuiltinTemplates：首次幂等落档「示例」模板（角色/世界切片/示例章），二次不重复创建', () => {
    const first = ensureBuiltinTemplates()
    expect(first.sort()).toEqual(['人物/示例角色.md', '正文/第01章_示例.md', '世界观/切片_示例切片_初遇.md'].sort())
    expect(existsSync(join(tplRoot(), BUILTIN_SAMPLE, '人物', '示例角色.md'))).toBe(true)
    expect(existsSync(join(tplRoot(), BUILTIN_SAMPLE, '正文', '第01章_示例.md'))).toBe(true)
    expect(ensureBuiltinTemplates()).toEqual([])
  })

  it('示例模板去占位化（2026-09-11）：人物档无「## 切片：示例切片_初遇」死节、说明改 HTML 注释；世界切片文件与运行时形态同构', () => {
    ensureBuiltinTemplates()
    const char = readFileSync(join(tplRoot(), BUILTIN_SAMPLE, '人物', '示例角色.md'), 'utf-8')
    expect(char).not.toContain('## 切片：示例切片_初遇')
    expect(char).not.toContain('（本切片的角色状态：')
    expect(char).toContain('<!--')
    const world = readFileSync(join(tplRoot(), BUILTIN_SAMPLE, '世界观', '切片_示例切片_初遇.md'), 'utf-8')
    expect(world.startsWith('# 切片：示例切片_初遇')).toBe(true)
    expect(world).toContain('> 本切片的世界状态')
    // 注释里允许举例提到小节名，但正文/注释外不得出现真实的「## 本切片时间点」小节行
    expect(world.split('\n').filter((l) => l.startsWith('## '))).toEqual([])
  })

  it('ensureBuiltinTemplates：已有模板不被覆盖（用户改动保留）', () => {
    ensureBuiltinTemplates()
    const f = join(tplRoot(), BUILTIN_SAMPLE, '人物', '示例角色.md')
    writeFileSync(f, '# 我改过的角色', 'utf-8')
    ensureBuiltinTemplates()
    expect(readFileSync(f, 'utf-8')).toBe('# 我改过的角色')
  })

  it('listTemplates：含内建示例 + 用户自定义目录，内建排最前；非目录/隐藏项不列', () => {
    ensureBuiltinTemplates()
    const userDir = join(tplRoot(), '我的系列')
    mkdirSync(join(userDir, '人物'), { recursive: true })
    writeFileSync(join(userDir, '人物', '主角.md'), '# X', 'utf-8')
    mkdirSync(join(tplRoot(), '.hidden'), { recursive: true })
    writeFileSync(join(tplRoot(), '一个文件.md'), '# 不是目录', 'utf-8')
    const list = listTemplates()
    expect(list.map((t) => t.id)).toEqual([BUILTIN_SAMPLE, '我的系列'])
    expect(list[0].builtin).toBe(true)
    expect(list[1].builtin).toBe(false)
  })

  it('applyTemplate：补充复制嵌套 .md，跳过已存在文件、project.md 与 .zhijuan；返回实际复制的相对路径', () => {
    ensureBuiltinTemplates()
    const target = join(holder.tmp, 'target')
    mkdirSync(join(target, '正文'), { recursive: true })
    writeFileSync(join(target, '正文', '第01章_示例.md'), '已有内容，不能被模板覆盖', 'utf-8')
    writeFileSync(join(target, 'person.md'), '模板里没有这份，复制时不应受影响', 'utf-8')
    // 模板里塞一个 project.md 与 .zhijuan 下的文件，验证被防御性跳过
    writeFileSync(join(tplRoot(), BUILTIN_SAMPLE, 'project.md'), '模板里的 project.md', 'utf-8')
    mkdirSync(join(tplRoot(), BUILTIN_SAMPLE, '.zhijuan', 'proposals'), { recursive: true })
    writeFileSync(join(tplRoot(), BUILTIN_SAMPLE, '.zhijuan', 'proposals', 'x.json'), '{}', 'utf-8')

    const r = applyTemplate(BUILTIN_SAMPLE, target)
    expect(r.ok).toBe(true)
    expect([...r.copied].sort()).toEqual(['人物/示例角色.md', '世界观/切片_示例切片_初遇.md'].sort())
    // 已存在的示例章未被覆盖
    expect(readFileSync(join(target, '正文', '第01章_示例.md'), 'utf-8')).toBe('已有内容，不能被模板覆盖')
    // project.md / .zhijuan 未被复制进目标
    expect(existsSync(join(target, 'project.md'))).toBe(false)
    expect(existsSync(join(target, '.zhijuan'))).toBe(false)
  })

  it('applyTemplate：模板不存在时 ok=false 且带错误信息', () => {
    const r = applyTemplate('不存在的模板', join(holder.tmp, 'target2'))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('模板不存在')
  })

  it('createProject 接线：传「示例」模板时示例文档进入新项目，project.md 仍是 store 生成的', () => {
    const p = createProject('测试模板项目', '用示例开的项目', '示例')
    expect(p).not.toBeNull()
    const root = join(holder.tmp, 'projects', p!.id)
    expect(existsSync(join(root, 'project.md'))).toBe(true)
    expect(existsSync(join(root, '人物', '示例角色.md'))).toBe(true)
    expect(existsSync(join(root, '世界观', '切片_示例切片_初遇.md'))).toBe(true)
    expect(existsSync(join(root, '正文', '第01章_示例.md'))).toBe(true)
    // 骨架默认文件也在
    expect(existsSync(join(root, '人物', '总览.md'))).toBe(true)
    expect(p!.stats.chapters).toBe(1)
  })
})
