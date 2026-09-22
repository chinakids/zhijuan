import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'

// electron 桩指向临时目录，其余全部真实文件系统（templates.test.ts 先例）
const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-lib-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, '文档') }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) },
  shell: { trashItem: async () => true }
}))

import { setSettings } from '../../src/main/settings'
import { createProject, projectDir, writeDoc } from '../../src/main/store'
import { listLibraryCategories, createLibraryCategory, searchDocs, recentLibraryDocs } from '../../src/main/library'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

let pid: string
beforeEach(() => {
  rmSync(join(holder.tmp, 'ws'), { recursive: true, force: true })
  rmSync(join(holder.tmp, 'projects'), { recursive: true, force: true })
  setSettings({ workspace: join(holder.tmp, 'ws'), libraryRoot: join(holder.tmp, 'projects') })
  const p = createProject('测试项目', '素材库域')!
  pid = p.id
})

describe('素材库类别（main/library.ts）', () => {
  it('listLibraryCategories：骨架初始无类别；写入素材后按目录枚举且 count 正确；采集池不算类别；空目录列出', () => {
    expect(listLibraryCategories(pid)).toEqual([])
    writeDoc(pid, '素材库/环境/校园.md', '# 校园\n\n借书卡的细节。\n')
    writeDoc(pid, '素材库/人物/账房.md', '# 账房\n')
    writeDoc(pid, '素材库/采集池/任务_x.md', '---\nstatus: pending\n---\n# 任务\n')
    const cats = listLibraryCategories(pid)
    const byName = Object.fromEntries(cats.map((c) => [c.name, c.count]))
    expect(byName).toEqual({ 人物: 1, 环境: 1 })
    // 空目录也列出（自由建类别后未放素材）
    mkdirSync(join(projectDir(pid), '素材库', '器物'), { recursive: true })
    expect(listLibraryCategories(pid)).toContainEqual({ name: '器物', count: 0 })
  })

  it('createLibraryCategory：建目录；重名/空名/全空白报错不覆盖', () => {
    expect(createLibraryCategory(pid, '场景')).toEqual({ ok: true })
    expect(existsSync(join(projectDir(pid), '素材库', '场景'))).toBe(true)
    expect(createLibraryCategory(pid, '场景')).toMatchObject({ ok: false })
    expect(createLibraryCategory(pid, '')).toMatchObject({ ok: false })
    expect(createLibraryCategory(pid, '    ')).toMatchObject({ ok: false })
    // 危险字符被清洗（sanitizeFile）
    expect(createLibraryCategory(pid, 'a/b\\c')).toEqual({ ok: true })
    expect(existsSync(join(projectDir(pid), '素材库', 'a_b_c'))).toBe(true)
  })

  it('searchDocs：文件名命中 / 正文命中 / 空格分词 AND / 大小写不敏感 / 排除采集池 / limit', () => {
    writeDoc(pid, '素材库/环境/校园.md', '# 校园老图书馆\n\n老樟木味混着纸页的霉味。\n')
    writeDoc(pid, '素材库/环境/口袋妖怪站.md', '# 站台\n\nPokemon center\n')
    writeDoc(pid, '素材库/人物/账房.md', '# 账房\n\n算盘 铜油灯 蝇头小楷\n')
    writeDoc(pid, '素材库/采集池/任务_x.md', '---\nstatus: pending\n---\n# 采集任务：校园\n')

    // 文件名命中（校园.md → name 命中；任务_x.md 正文含「校园」→ content 命中）
    const byName = searchDocs(pid, '素材库', '校园')
    expect(byName.map((h) => h.name).sort()).toEqual(['任务_x', '校园'].sort())
    expect(byName.find((h) => h.name === '校园')!.field).toBe('name')
    // 排除采集池后：只命中素材
    const excl = searchDocs(pid, '素材库', '校园', { excludePrefix: ['素材库/采集池/'] })
    expect(excl.map((h) => h.name)).toEqual(['校园'])
    // 正文命中 + snippet
    const byContent = searchDocs(pid, '素材库', '樟木')
    expect(byContent).toHaveLength(1)
    expect(byContent[0]).toMatchObject({ name: '校园', field: 'content' })
    expect(byContent[0].snippet).toContain('老樟木味')
    // AND：两个词都在才算
    expect(searchDocs(pid, '素材库', '樟木 霉味')).toHaveLength(1)
    expect(searchDocs(pid, '素材库', '樟木 账房')).toHaveLength(0)
    // 大小写不敏感
    expect(searchDocs(pid, '素材库', 'pokemon')).toHaveLength(1)
    // limit
    expect(searchDocs(pid, '素材库', '校园', { limit: 1 })).toHaveLength(1)
    // 空查询
    expect(searchDocs(pid, '素材库', '  ')).toHaveLength(0)
  })

  it('searchDocs：命中按 mtime 新→旧排序、limit 保留最新 N 条（finalizeSearchHits 语义）', () => {
    writeDoc(pid, '素材库/环境/校园.md', '# 校园老图书馆\n\n老樟木味混着纸页的霉味。\n')
    writeDoc(pid, '素材库/环境/旧稿.md', '# 校园旧稿\n\n校园 大榕树 旧钟楼。\n')
    writeDoc(pid, '素材库/环境/新采.md', '# 校园新采\n\n校园 新操场 塑胶跑道。\n')
    // 显式 mtime：新采(30) > 旧稿(20) > 校园(10)——readdir 枚举序（创建序）与 mtime 序相反，
    // 旧实现按枚举序截断「校园」会挤出「新采」；新实现排序后截断必保最新。
    const f1 = join(projectDir(pid), '素材库/环境/校园.md')
    const f2 = join(projectDir(pid), '素材库/环境/旧稿.md')
    const f3 = join(projectDir(pid), '素材库/环境/新采.md')
    utimesSync(f1, 10, 10)
    utimesSync(f2, 20, 20)
    utimesSync(f3, 30, 30)
    const all = searchDocs(pid, '素材库', '校园')
    expect(all.map((h) => h.name)).toEqual(['新采', '旧稿', '校园'])
    const lim = searchDocs(pid, '素材库', '校园', { limit: 2 })
    expect(lim.map((h) => h.name)).toEqual(['新采', '旧稿'])
  })

  it('recentLibraryDocs：按 mtime 新→旧、排除采集池、n 截断、空库（骨架仅索引）返回索引', () => {
    expect(recentLibraryDocs(pid, 5).map((d) => d.name)).toEqual(['索引']) // 骨架自带 素材库/索引.md
    writeDoc(pid, '素材库/环境/校园.md', '# 校园\n')
    writeDoc(pid, '素材库/人物/账房.md', '# 账房\n')
    writeDoc(pid, '素材库/人物/掌柜.md', '# 掌柜\n')
    writeDoc(pid, '素材库/采集池/任务_x.md', '---\nstatus: pending\n---\n# 任务\n')
    const all = recentLibraryDocs(pid, 5)
    expect(all.map((d) => d.name)).toEqual(['掌柜', '账房', '校园', '索引']) // 采集池被排除；mtime 新→旧
    expect(all[0]).toMatchObject({ file: '素材库/人物/掌柜.md', name: '掌柜' })
    // n 截断
    expect(recentLibraryDocs(pid, 3)).toHaveLength(3)
    // 子目录素材也纳入（与 searchDocs 同口径枚举）
    writeDoc(pid, '素材库/环境/子/站台.md', '# 站台\n')
    expect(recentLibraryDocs(pid, 10).map((d) => d.name)).toContain('站台')
  })
})
