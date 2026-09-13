import { describe, expect, it } from 'vitest'
import { actGapsCheck } from '../../src/shared/actGaps'
import { actPlaceholder } from '../../src/shared/actsSeg'

const ch = (file: string, body: string): { file: string; raw: string } => ({
  file,
  raw: `---\n章号: 1\n题名: 测试\n---\n` + body
})

describe('actGapsCheck（正文缺段核查纯函数）', () => {
  it('正文无占位注释 → 零命中且有 summary', () => {
    const r = actGapsCheck({ chapters: [ch('正文/第01章_雾港.md', '正文内容。\n\n她推门走进来。\n')] })
    expect(r.items).toEqual([])
    expect(r.summary).toContain('均无分幕缺段占位注释')
  })

  it('命中占位注释 → 一条 structure 条目，带缺段号与文件', () => {
    const body = `她回头。\n\n${actPlaceholder(2)}\n\n然后说：走吧。\n`
    const r = actGapsCheck({ chapters: [ch('正文/第01章_雾港.md', body)] })
    expect(r.items.length).toBe(1)
    const it0 = r.items[0]
    expect(it0.severity).toBe('medium')
    expect(it0.type).toBe('structure')
    expect(it0.where).toContain('测试')
    expect(it0.where).toContain('正文/第01章_雾港.md')
    expect(it0.what).toContain('缺第 2 段')
    expect(it0.suggest).toContain('补写缺段')
    expect(r.summary).toContain('1 章正文残留')
  })

  it('多处缺段合并为一条（升序去重）', () => {
    const body = `${actPlaceholder(3)}\n\n${actPlaceholder(1)}\n\n${actPlaceholder(3)}\n`
    const r = actGapsCheck({ chapters: [ch('正文/第02章_晨.md', body)] })
    expect(r.items.length).toBe(1)
    expect(r.items[0].what).toContain('缺第 1、3 段')
    expect(r.items[0].what).toContain('2 处')
  })

  it('作者自定义注释不误伤（非分幕占位不命中）', () => {
    const body = `<!-- TODO：这里后面要补一段对话 -->\n\n正文。\n`
    const r = actGapsCheck({ chapters: [ch('正文/第03章_夜.md', body)] })
    expect(r.items).toEqual([])
  })

  it('empty/仅空文件 → 空态', () => {
    const r = actGapsCheck({ chapters: [] })
    expect(r.items).toEqual([])
    expect(r.summary).toContain('还没有正文章节')
  })
})
