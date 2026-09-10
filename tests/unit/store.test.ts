import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync } from 'fs'
import { join } from 'path'

// electron 是唯一外部依赖：这里只在测试里把 getPath 指向临时目录，其余全部走真实文件系统
const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-store-'))
  return {
    tmp,
    userData: path.join(tmp, 'userData'),
    documents: path.join(tmp, '文档'),
    projects: () => path.join(tmp, 'projects')
  }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) },
  shell: { trashItem: vi.fn() }
}))

import { shell } from 'electron'
import * as store from '../../src/main/store'
import { setSettings, libraryRoot } from '../../src/main/settings'
import { sanitizeFile } from '../../src/shared/paths'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

beforeEach(() => {
  // 让每个用例从干净的老库状态出发（D-V2-8 的 legacy 探测要可复现）
  rmSync(join(holder.documents, '织卷项目库'), { recursive: true, force: true })
})

describe('sanitizeFile（文件名清洗）', () => {
  it('危险字符全部替换为下划线；两侧空白被清', () => {
    expect(sanitizeFile('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeFile('  名字  ')).toBe('名字')
  })
  it('超长截断且不以空格收尾；空白输入回落「未命名」', () => {
    expect(sanitizeFile('很'.repeat(80)).length).toBeLessThanOrEqual(60)
    expect(sanitizeFile('   ')).toBe('未命名')
  })
})

describe('项目全流程（临时目录真实落盘）', () => {
  beforeEach(() => {
    setSettings({ workspace: join(holder.tmp, 'ws'), libraryRoot: holder.projects() })
  })
  afterEach(() => {
    setSettings({ workspace: '', libraryRoot: '' })
  })

  it('createProject：骨架齐全、模板落档、统计归零', () => {
    const p = store.createProject('雾港', '迷雾之城')!
    const dir = join(holder.projects(), p.id)
    for (const d of ['正文', '人物', '世界观', '素材库', '素材库/采集池', '.zhijuan/proposals', '.zhijuan/sessions', '.zhijuan/tasks']) {
      expect(existsSync(join(dir, d))).toBe(true)
    }
    expect(existsSync(join(dir, '人物/总览.md'))).toBe(true)
    expect(existsSync(join(dir, '世界观/总纲.md'))).toBe(true)
    const meta = readFileSync(join(dir, 'project.md'), 'utf-8')
    expect(meta).toContain('name: 雾港')
    expect(meta).toContain('时间线总纲')
    expect(p.stats).toEqual({ chapters: 0, characters: 0, worldviewFiles: 0, materials: 1 }) // skeleton 自带的 素材库/索引.md 计入
  })

  it('同名项目自动加后缀，不互相覆盖', () => {
    const a = store.createProject('同名', '')!
    const b = store.createProject('同名', '')!
    expect(a.id).not.toBe(b.id)
    expect(existsSync(join(holder.projects(), a.id, 'project.md'))).toBe(true)
    expect(existsSync(join(holder.projects(), b.id, 'project.md'))).toBe(true)
  })

  it('listDocs 返回相对 relDir 的路径（子目录同样相对）；新的在前', () => {
    const p = store.createProject('p', '')!
    store.writeDoc(p.id, '外页.md', '外')
    store.writeDoc(p.id, '正文/第1章_甲.md', '甲')
    utimesSync(join(holder.projects(), p.id, '正文/第1章_甲.md'), new Date('2020-01-01'), new Date('2020-01-01'))
    const later = store.writeDoc(p.id, '正文/子/第2章_乙.md', '乙')
    expect(later).toBeUndefined()
    const docs = store.listDocs(p.id, '正文')
    expect(docs.map((d) => d.file)).toEqual([join('子', '第2章_乙.md'), '第1章_甲.md'])
  })

  it('listChapters：按章号自然排序（第2章在前）、去空格词数、无约定头 fm 为 null', () => {
    const p = store.createProject('p', '')!
    store.writeDoc(p.id, '正文/第10章_甲.md', '---\n章号: 10\n---\n十 十')
    store.writeDoc(p.id, '正文/第2章_乙.md', '---\n章号: 2\n---\n二二二')
    store.writeDoc(p.id, '正文/无头.md', '没有约定头')
    const chs = store.listChapters(p.id)
    expect(chs).toHaveLength(3)
    expect(chs.map((c) => c.name)).toEqual(['第2章_乙', '第10章_甲', '无头'])
    expect(chs[0].fm?.['章号']).toBe(2) // extractFrontMatter 按字符串返回，此处应被归一成数值（对照线：真机此前一直是字符串，acts 找上一章因此失效）
    expect(chs[0].wordCount).toBe(3)
    expect(chs[1].wordCount).toBe(2) // 两个「十」之间有个空格，被去掉
    expect(chs[2].fm).toBeNull()
  })

  it('ensureSkeleton 幂等：已有模板文件内容不被覆盖', () => {
    const p = store.createProject('p', '')!
    const f = join(holder.projects(), p.id, '人物/总览.md')
    const before = readFileSync(f, 'utf-8')
    store.ensureSkeleton(p.id)
    expect(readFileSync(f, 'utf-8')).toBe(before)
  })

  it('libraryRoot：老默认位（文档/织卷项目库）非空时保持原地（D-V2-8）', () => {
    const legacy = join(holder.documents, '织卷项目库')
    mkdirSync(join(legacy, '老项目'), { recursive: true })
    setSettings({ libraryRoot: '' })
    expect(libraryRoot()).toBe(legacy)
  })

  it('libraryRoot：全新用户（老位不存在）回落 工作区/项目库', () => {
    setSettings({ workspace: join(holder.tmp, 'ws2'), libraryRoot: '' })
    expect(libraryRoot()).toBe(join(holder.tmp, 'ws2', '项目库'))
  })
})

describe('deleteDoc（删除项目内文档：废纸篓优先、路径校验、兜底硬删）', () => {
  beforeEach(() => {
    setSettings({ workspace: join(holder.tmp, 'ws'), libraryRoot: holder.projects() })
    vi.mocked(shell.trashItem).mockReset()
    vi.mocked(shell.trashItem).mockResolvedValue(undefined)
  })
  afterEach(() => {
    setSettings({ workspace: '', libraryRoot: '' })
  })

  it('正常路径：调用系统废纸篓（可恢复）并返回 ok', async () => {
    const p = store.createProject('p', '')!
    const rel = '素材库/采集池/任务_x.md'
    store.writeDoc(p.id, rel, '---\nstatus: pending\n---\n任务')
    const r = await store.deleteDoc(p.id, rel)
    expect(r.ok).toBe(true)
    expect(shell.trashItem).toHaveBeenCalledWith(join(holder.projects(), p.id, rel))
  })

  it('废纸篓失败：兜底硬删，文件确实消失', async () => {
    const p = store.createProject('p', '')!
    const rel = '素材库/采集池/任务_y.md'
    store.writeDoc(p.id, rel, '---\nstatus: pending\n---\n任务')
    vi.mocked(shell.trashItem).mockRejectedValueOnce(new Error('trash fail'))
    const r = await store.deleteDoc(p.id, rel)
    expect(r.ok).toBe(true)
    expect(existsSync(join(holder.projects(), p.id, rel))).toBe(false)
  })

  it('路径校验：空/非 md/绝对路径/带 .. 一律拒绝且不调废纸篓', async () => {
    const p = store.createProject('p', '')!
    for (const rel of ['', '任务_x', '/abs/任务_x.md', '../任务_x.md', '素材库/../任务_x.md']) {
      const r = await store.deleteDoc(p.id, rel)
      expect(r.ok).toBe(false)
      expect(r.error).toBe('路径不合法')
    }
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('文件不存在：返回 ok:false（不报错不删别的东西）', async () => {
    const p = store.createProject('p', '')!
    const r = await store.deleteDoc(p.id, '素材库/采集池/不存在.md')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('文档不存在')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })
})
