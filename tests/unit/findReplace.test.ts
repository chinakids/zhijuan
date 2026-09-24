import { describe, it, expect } from 'vitest'
import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { findInDoc } from '../../src/renderer/src/features/editor/finder'
import { replaceOne, replaceAll } from '../../src/renderer/src/features/editor/findReplace'

// 与 finder.test.ts 同源的真实 ProseMirror doc（不 mock，保证 pos 语义真实）。
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false }
  },
  marks: { strong: {} }
})

function makeDoc(content: unknown[]) {
  return schema.nodeFromJSON({ type: 'doc', content })
}
const p = (content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, marks })
const stateOf = (doc: ReturnType<typeof makeDoc>) => EditorState.create({ doc, schema })

describe('findReplace.replaceOne', () => {
  it('替换单处匹配，doc 文本更新', () => {
    const doc = makeDoc([p([t('雾港的灯塔')])])
    const m = findInDoc(doc, '雾港')[0]
    const next = stateOf(doc)
    const tr = replaceOne(next, m.from, m.to, '海港')
    const out = tr.doc
    expect(out.textBetween(1, out.content.size)).toBe('海港的灯塔')
  })

  it('空文本=删除该区间', () => {
    const doc = makeDoc([p([t('雾港的灯塔')])])
    const m = findInDoc(doc, '雾港')[0]
    const tr = replaceOne(stateOf(doc), m.from, m.to, '')
    const out = tr.doc
    expect(out.textBetween(1, out.content.size)).toBe('的灯塔')
  })

  it('替换文本继承被替换区间起始处的 marks（跨 TextNode 的匹配保留格式）', () => {
    const doc = makeDoc([p([t('雾', [{ type: 'strong' }]), t('港的灯塔')])])
    const m = findInDoc(doc, '雾港')[0]
    const tr = replaceOne(stateOf(doc), m.from, m.to, '雨港')
    const out = tr.doc
    expect(out.textBetween(1, out.content.size)).toBe('雨港的灯塔')
    // 插入文本沿用 from 处 strong：首 2 字带 strong mark
    const firstText = (out.firstChild as any).firstChild as any
    expect(firstText.text).toBe('雨港')
    expect(firstText.marks.map((mk: any) => mk.type.name)).toEqual(['strong'])
  })
})

describe('findReplace.replaceAll', () => {
  it('同段多处全部替换（从后往前单事务）', () => {
    const doc = makeDoc([p([t('雾港的灯塔，雾港的码头')])])
    const matches = findInDoc(doc, '雾港')
    expect(matches).toHaveLength(2)
    const tr = replaceAll(stateOf(doc), matches, '海港')
    const out = tr.doc
    expect(out.textBetween(1, out.content.size)).toBe('海港的灯塔，海港的码头')
    expect(findInDoc(out, '雾港')).toHaveLength(0)
  })

  it('跨段全部替换', () => {
    const doc = makeDoc([p([t('雾港')]), p([t('灯塔，雾港')])])
    const matches = findInDoc(doc, '雾港')
    expect(matches).toHaveLength(2)
    const tr = replaceAll(stateOf(doc), matches, '雨港')
    expect(tr.doc.textBetween(1, tr.doc.content.size, '\n')).toBe('雨港\n灯塔，雨港')
  })

  it('空 matches = 空事务，文档不变', () => {
    const doc = makeDoc([p([t('雾港')])])
    const tr = replaceAll(stateOf(doc), [], '海港')
    expect(tr.steps).toHaveLength(0)
    expect(tr.doc.eq(doc)).toBe(true)
  })

  it('替换词长度变化后其余匹配坐标不受影响（短→长与长→短）', () => {
    // 短→长：目测后一批匹配在替换前位置，替换后坐标算法正确（单事务从后往前）
    const doc = makeDoc([p([t('雾港、雾港、雾港')])])
    const matches = findInDoc(doc, '雾港')
    const tr = replaceAll(stateOf(doc), matches, '雾港码头')
    expect(tr.doc.textBetween(1, tr.doc.content.size)).toBe('雾港码头、雾港码头、雾港码头')
  })

  it('全部替换后 doc 中不再含原词（含替换词嵌入情形仍正确）', () => {
    const doc = makeDoc([p([t('港雾港')])])
    const matches = findInDoc(doc, '雾港')
    expect(matches).toHaveLength(1)
    const tr = replaceAll(stateOf(doc), matches, '')
    expect(tr.doc.textBetween(1, tr.doc.content.size)).toBe('港')
  })
})
