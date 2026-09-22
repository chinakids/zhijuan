import { describe, it, expect } from 'vitest'
import { Schema } from 'prosemirror-model'
import { splitPlainParagraphs, plainTextSlice } from '../../src/renderer/src/features/editor/pastePlain'

function makeSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block' },
      text: { group: 'inline' },
      hardbreak: { inline: true, group: 'inline', selectable: false }
    }
  })
}

describe('splitPlainParagraphs（空行分段 + 换行归一）', () => {
  it('单段：无空行原样成段', () => {
    expect(splitPlainParagraphs('第一段文字')).toEqual(['第一段文字'])
  })
  it('双段：空行分隔', () => {
    expect(splitPlainParagraphs('第一段\n\n第二段')).toEqual(['第一段', '第二段'])
  })
  it('段内单换行保留为同一段（行内 \n 由 hardbreak 承载）', () => {
    expect(splitPlainParagraphs('第一行\n第二行')).toEqual(['第一行\n第二行'])
  })
  it('\\r\\n 归一为 \\n', () => {
    expect(splitPlainParagraphs('甲\r\n乙\r\n\r\n丙')).toEqual(['甲\n乙', '丙'])
  })
  it('连续空行只分一段', () => {
    expect(splitPlainParagraphs('甲\n\n\n乙')).toEqual(['甲', '乙'])
  })
  it('首尾空行忽略', () => {
    expect(splitPlainParagraphs('\n甲\n\n乙\n')).toEqual(['甲', '乙'])
  })
  it('纯空文本 → 空数组', () => {
    expect(splitPlainParagraphs('')).toEqual([])
    expect(splitPlainParagraphs('\n\n')).toEqual([])
  })
})

describe('plainTextSlice（字面文本入正文，不经 markdown 解析）', () => {
  const schema = makeSchema()
  it('单段：一个 paragraph + 字面 text', () => {
    const s = plainTextSlice(['# 不是标题'], schema)
    expect(s).not.toBeNull()
    const para = (s!.content as unknown as { firstChild?: unknown }).firstChild
    // 通过 Fragment 结构核验
    expect(s!.content.childCount).toBe(1)
    const p = s!.content.child(0)
    expect(p.type.name).toBe('paragraph')
    expect(p.textContent).toBe('# 不是标题')
    expect(p.childCount).toBe(1)
    expect(p.child(0).type.name).toBe('text')
  })
  it('多段：两个 paragraph', () => {
    const s = plainTextSlice(['甲', '乙'], schema)
    expect(s!.content.childCount).toBe(2)
    expect(s!.content.child(0).textContent).toBe('甲')
    expect(s!.content.child(1).textContent).toBe('乙')
  })
  it('段内换行 → hardbreak 节点', () => {
    const s = plainTextSlice(['第一行\n第二行'], schema)
    const p = s!.content.child(0)
    expect(p.childCount).toBe(3)
    expect(p.child(1).type.name).toBe('hardbreak')
    expect(p.textContent).toBe('第一行第二行')
  })
  it('markdown 特征字符按字面保留（不解析为标题/列表）', () => {
    const s = plainTextSlice(['- 列表项', '> 引用'], schema)
    expect(s!.content.child(0).type.name).toBe('paragraph')
    expect(s!.content.child(0).textContent).toBe('- 列表项')
    expect(s!.content.child(1).type.name).toBe('paragraph')
    expect(s!.content.child(1).textContent).toBe('> 引用')
  })
  it('空数组 → null（调用方不插入）', () => {
    expect(plainTextSlice([], schema)).toBeNull()
  })
  it('schema 无 paragraph 节点 → null', () => {
    const noPara = new Schema({
      nodes: { doc: { content: 'para' }, para: { content: 'text*', group: 'block' }, text: {} }
    })
    expect(plainTextSlice(['甲'], noPara)).toBeNull()
  })
  it('无 hardbreak 时段内换行退化为空格', () => {
    const noHb = new Schema({
      nodes: { doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' } }
    })
    const s = plainTextSlice(['甲\n乙'], noHb)
    expect(s).not.toBeNull()
    const p = s!.content.child(0)
    expect(p.textContent).toBe('甲 乙')
  })
})
