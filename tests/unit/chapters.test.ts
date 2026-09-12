import { describe, expect, it } from 'vitest'
import { listChapterEntries, type ChapterSource } from '../../src/shared/chapters'

// shared/chapters：章节列表解析口径（真机 store.listChapters 与 devShim 共用同一实现，2026-09-12）
// 重点锁住老 devShim 手写正则分叉过的行为：只认约定头块、剥行尾注释、空数组不产生键、按文件名章号排序。
function src(file: string, text: string, mtime = 1000): ChapterSource {
  return { file, name: file.replace(/\.md$/, ''), text, mtime }
}

const FM1 = ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港之夜', '涉及人物: [阿七, 沈藏]', '---', '', '# 雾港', '', '正文。'].join('\n')

describe('listChapterEntries（与真机同口径）', () => {
  it('完整约定头：章号归一为 number、涉及人物为 string[]、wordCount 计正文字数', () => {
    const [c] = listChapterEntries([src('第01章_雾港.md', FM1)])
    expect(c.fm?.['章号']).toBe(1)
    expect(c.fm?.['题名']).toBe('雾港')
    expect(c.fm?.['切片']).toBe('第一幕_雾港之夜')
    expect(c.fm?.['涉及人物']).toEqual(['阿七', '沈藏'])
    expect(c.wordCount).toBeGreaterThan(0)
    expect(c.hasPendingProposal).toBe(false)
    expect(c.mtime).toBe(1000)
  })

  it('只认约定头块：正文里出现「章号: 9」但无 front matter → fm 为 null（旧正则版会误解析）', () => {
    const [c] = listChapterEntries([src('第05章_无约定头.md', '# 第五章\n\n章号: 9\n正文。')])
    expect(c.fm).toBeNull()
  })

  it('ok 判据＝任一关键字段（章号/切片/题名）；只有题名也算合法约定头', () => {
    const only = ['---', '题名: 无名', '---', '', '正文。'].join('\n')
    const [c] = listChapterEntries([src('第03章_x.md', only)])
    expect(c.fm).not.toBeNull()
    expect(c.fm?.['题名']).toBe('无名')
  })

  it('剥行尾 # 注释（extractFrontMatter 语义）', () => {
    const t = ['---', '章号: 2', '题名: 灯塔 # 备选名', '---', '', '正文。'].join('\n')
    const [c] = listChapterEntries([src('第02章_灯塔.md', t)])
    expect(c.fm?.['题名']).toBe('灯塔')
  })

  it('涉及人物: []（空数组）不产生键——与真机 extractFrontMatter 一致（旧 devShim 会带空数组键）', () => {
    const t = ['---', '章号: 4', '题名: 雾夜', '涉及人物: []', '---', '', '正文。'].join('\n')
    const [c] = listChapterEntries([src('第04章_雾夜.md', t)])
    expect(c.fm).not.toBeNull()
    expect('涉及人物' in (c.fm ?? {})).toBe(false)
  })

  it('排序按文件名章号数值：第2章 在 第10章 前；无章号文件名排最后（与真机 numOf 同口径）', () => {
    const mk = (file: string, no: number) => src(file, `---\n章号: ${no}\n题名: ${file}\n---\n正文。`)
    const out = listChapterEntries([
      mk('第10章_十.md', 10),
      mk('第02章_二.md', 2),
      src('序章.md', mk('序章.md', 0).text) // 顺序无关，文件名无第N章 → Infinity
    ].map((s, i) => ({ ...s, file: s.file, mtime: i })))
    expect(out.map((c) => c.file)).toEqual(['第02章_二.md', '第10章_十.md', '序章.md'])
  })
})
