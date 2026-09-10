import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// electron 是唯一外部依赖：只在测试里 mock shell（trashItem 模拟「移入废纸篓」= 移动到 tmp/trash，保留可恢复语义），其余全走真实文件系统（与 store.test.ts 同模式）
const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string; basename(p: string): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as {
    mkdtempSync(p: string): string
    mkdirSync(p: string, o?: { recursive?: boolean }): void
    renameSync(a: string, b: string): void
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-chops-'))
  const trash = path.join(tmp, 'trash')
  fs.mkdirSync(trash, { recursive: true })
  let seq = 0
  const trashItem = async (p: string) => {
    seq++
    fs.renameSync(p, path.join(trash, `${path.basename(p)}-${seq}`))
  }
  return {
    tmp,
    userData: path.join(tmp, 'userData'),
    documents: path.join(tmp, '文档'),
    projects: () => path.join(tmp, 'projects'),
    trashItem
  }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) },
  shell: { trashItem: vi.fn(holder.trashItem) }
}))

import { shell } from 'electron'
import * as store from '../../src/main/store'
import { setSettings } from '../../src/main/settings'
import { createProposals, listProposals } from '../../src/main/proposals'
import type { ProposalItem } from '../../src/shared/types'

const propItem = (after: string): ProposalItem => ({
  target: '人物/阿七.md',
  anchor: '## 现时状态',
  kind: 'upsert-section',
  before: '',
  after,
  reason: '测试'
})

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

let pid = ''
beforeEach(() => {
  setSettings({ workspace: join(holder.tmp, 'ws'), libraryRoot: holder.projects() })
  vi.mocked(shell.trashItem).mockClear()
  const p = store.createProject('雾港', '测试')
  pid = p!.id
})

function proj(): string {
  return join(holder.projects(), pid)
}

/** 造一个带约定头的章节 + 大纲副产物（章卡/导演板）+ 版本历史目录，返回正文相对路径 */
function seedChapter(): string {
  const rel = '正文/第01章_雾港.md'
  store.writeDoc(
    pid,
    rel,
    ['---', '章号: 1', '题名: 雾港', '切片: 第一幕', '涉及人物: [阿七]', '---', '', '# 雾港', '', '正文内容。', ''].join('\n')
  )
  store.writeDoc(pid, '大纲/第01章_雾港.md', '# 章卡 第1章 雾港\n\n> 对应正文：正文/第01章_雾港.md\n')
  store.writeDoc(pid, '大纲/第01章_雾港_导演.md', '# 导演板 第1章 雾港\n')
  const hd = join(proj(), '.zhijuan/history/正文/第01章_雾港')
  mkdirSync(hd, { recursive: true })
  writeFileSync(join(hd, '20260901-000000-000.md'), '旧版正文', 'utf-8')
  return rel
}

describe('chapterNewBase（重命名文件名基础）', () => {
  it('保留「第N章_」前缀，替换题名 slug', () => {
    expect(store.chapterNewBase('第01章_雾港.md', '灯下雾')).toBe('第01章_灯下雾')
  })
  it('无下划线前缀（手改过文件名）→ 直接用新题名；危险字符被清洗', () => {
    expect(store.chapterNewBase('草稿a.md', '新/名:字')).toBe('新_名_字')
  })
})

describe('renameChapter（重命名：约定头题名 + 文件名 + 引用面）', () => {
  it('改题名并迁移：新文件内容正确、旧文件删除、大纲副产物/版本历史随同改名', () => {
    const rel = seedChapter()
    const r = store.renameChapter(pid, rel, '灯下雾')
    expect(r.ok).toBe(true)
    expect(r.newRel).toBe('正文/第01章_灯下雾.md')
    // 旧文件不在，新文件在且约定头题名已改、正文保留
    expect(existsSync(join(proj(), '正文/第01章_雾港.md'))).toBe(false)
    const next = readFileSync(join(proj(), '正文/第01章_灯下雾.md'), 'utf-8')
    expect(next).toContain('题名: 灯下雾')
    expect(next).toContain('正文内容。')
    expect(next).toContain('涉及人物: [阿七]')
    // 大纲副产物随同改名
    expect(existsSync(join(proj(), '大纲/第01章_雾港.md'))).toBe(false)
    expect(existsSync(join(proj(), '大纲/第01章_灯下雾.md'))).toBe(true)
    expect(existsSync(join(proj(), '大纲/第01章_灯下雾_导演.md'))).toBe(true)
    // 版本历史目录随同改名
    expect(existsSync(join(proj(), '.zhijuan/history/正文/第01章_雾港'))).toBe(false)
    expect(existsSync(join(proj(), '.zhijuan/history/正文/第01章_灯下雾'))).toBe(true)
  })

  it('题名清洗后与旧 slug 同形：只改约定头内容，不产生文件改名', () => {
    const rel = seedChapter()
    const r = store.renameChapter(pid, rel, '雾港 ') // 清洗后仍为「雾港」
    expect(r.ok).toBe(true)
    expect(r.newRel).toBe(rel)
    expect(existsSync(join(proj(), '正文/第01章_雾港.md'))).toBe(true)
    const next = readFileSync(join(proj(), '正文/第01章_雾港.md'), 'utf-8')
    expect(next).toContain('题名: 雾港') // 值 trim 后不变
  })

  it('防御：空题名 / 章节不存在 / 无约定头 / 目标文件已存在', () => {
    const rel = seedChapter()
    expect(store.renameChapter(pid, rel, '   ').ok).toBe(false)
    expect(store.renameChapter(pid, '正文/不存在.md', '新名').ok).toBe(false)
    store.writeDoc(pid, '正文/无约定头.md', '没有约定头的文件')
    expect(store.renameChapter(pid, '正文/无约定头.md', '新名').ok).toBe(false)
    // 目标已存在
    store.writeDoc(pid, '正文/第01章_灯下雾.md', '# 占位\n')
    const r = store.renameChapter(pid, rel, '灯下雾')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已存在')
  })

  it('防御：路径不合法（绝对路径 / .. 穿越 / 非正文）', () => {
    expect(store.renameChapter(pid, '/etc/passwd.md', 'a').ok).toBe(false)
    expect(store.renameChapter(pid, '正文/../project.md', 'a').ok).toBe(false)
    expect(store.renameChapter(pid, '人物/阿七.md', 'a').ok).toBe(false)
  })

  it('引用面联动：proposals.chapter 随同迁移，同章再同步旧 pending 正确置 stale', () => {
    const rel = seedChapter()
    createProposals(holder.projects(), pid, 'slice-sync', rel, '第一幕', [propItem('旧状态')])

    const r = store.renameChapter(pid, rel, '灯下雾')
    expect(r.ok).toBe(true)

    // chapter 指针随同迁移（抽屉展示 + stale 判定）
    const after = listProposals(holder.projects(), pid)
    expect(after).toHaveLength(1)
    expect(after[0].chapter).toBe('正文/第01章_灯下雾.md')
    expect(after[0].items[0].after).toBe('旧状态') // 审计内容不动

    // 同章再同步（新路径）→ 旧 pending 置 stale（不迁移则失效）
    createProposals(holder.projects(), pid, 'slice-sync', '正文/第01章_灯下雾.md', '第一幕', [propItem('新状态')])
    const all = listProposals(holder.projects(), pid)
    expect(all.find((x) => x.status === 'pending' && x.items[0].after === '新状态')).toBeDefined()
    expect(all.find((x) => x.status === 'stale' && x.items[0].after === '旧状态')).toBeDefined()
  })

  it('引用面联动：题名清洗后同形（未改名）时不触碰提案', () => {
    const rel = seedChapter()
    createProposals(holder.projects(), pid, 'slice-sync', rel, '第一幕', [propItem('状态')])
    store.renameChapter(pid, rel, '雾港 ')
    expect(listProposals(holder.projects(), pid)[0].chapter).toBe(rel)
  })
})

describe('deleteChapter（删除：正文 + 大纲副产物进废纸篓）', () => {
  it('正文与同名大纲副产物全部 trashItem，cleaned 计数正确', async () => {
    const rel = seedChapter()
    const r = await store.deleteChapter(pid, rel)
    expect(r.ok).toBe(true)
    expect(r.cleaned).toBe(2)
    expect(vi.mocked(shell.trashItem)).toHaveBeenCalledTimes(3)
    expect(existsSync(join(proj(), '正文/第01章_雾港.md'))).toBe(false)
    expect(existsSync(join(proj(), '大纲/第01章_雾港.md'))).toBe(false)
    expect(existsSync(join(proj(), '大纲/第01章_雾港_导演.md'))).toBe(false)
  })
  it('无大纲副产物时也能删（cleaned=0）', async () => {
    store.writeDoc(pid, '正文/第02章_孤章.md', ['---', '章号: 2', '题名: 孤章', '---', '', '# 孤章', ''].join('\n'))
    const r = await store.deleteChapter(pid, '正文/第02章_孤章.md')
    expect(r.ok).toBe(true)
    expect(r.cleaned).toBe(0)
    expect(existsSync(join(proj(), '正文/第02章_孤章.md'))).toBe(false)
  })
  it('防御：路径不合法 / 章节不存在', async () => {
    expect((await store.deleteChapter(pid, '正文/../project.md')).ok).toBe(false)
    expect((await store.deleteChapter(pid, '正文/不存在.md')).ok).toBe(false)
  })
})
