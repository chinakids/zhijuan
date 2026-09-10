import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from 'prosemirror-model'
import { findInDoc } from '../../src/renderer/src/features/editor/finder'

// 与 Prose.tsx 同源的真实 ProseMirror doc（不 mock descendants，保证 pos 语义真实）。
// 坐标基线（prosemirror-model 1.25 实测）：doc 首段内首文本节点 = pos 1，
// textBetween(1, len+1) 可原样取出该文本；段落间按 nodeSize 累计。
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

/** 双重校验：① 每个匹配 from/to 等于精确值；② textBetween(from,to) 语义必须等于 query（防坐标错位） */
function expectMatches(doc: PMNode, query: string, positions: Array<[number, number]>) {
  const r = findInDoc(doc, query)
  expect(r).toHaveLength(positions.length)
  positions.forEach(([from, to], i) => {
    expect(r[i].from).toBe(from)
    expect(r[i].to).toBe(to)
    expect(doc.textBetween(from, to).toLowerCase()).toBe(query.toLowerCase())
  })
  return r
}

describe('finder.findInDoc', () => {
  it('空 query 返回空', () => {
    const doc = makeDoc([p([t('雾港')])])
    expect(findInDoc(doc, '')).toEqual([])
    expect(findInDoc(doc, '   ')).toEqual([])
  })

  it('无匹配返回空', () => {
    const doc = makeDoc([p([t('灯塔')])])
    expect(findInDoc(doc, '雾港')).toEqual([])
  })

  it('单段 ASCII：大小写不敏感且位置正确', () => {
    const doc = makeDoc([p([t('Hello World')])])
    expectMatches(doc, 'world', [[7, 12]])
  })

  it('中文多匹配', () => {
    const doc = makeDoc([p([t('雾港的雾港')])])
    expectMatches(doc, '雾港', [
      [1, 3],
      [4, 6]
    ])
  })

  it('跨行内标记（多个相邻 TextNode）合并匹配', () => {
    // 「雾」加粗 + 「港」「雾」「港」普通：ProseMirror 会拆成 4 个 TextNode
    const doc = makeDoc([
      p([
        t('雾', [{ type: 'strong' }]),
        t('港'),
        t('雾', [{ type: 'strong' }]),
        t('港')
      ])
    ])
    expectMatches(doc, '雾港', [
      [1, 3],
      [3, 5]
    ])
  })

  it('跨段落：位置按块累计且 textBetween 语义正确', () => {
    const doc = makeDoc([p([t('abc')]), p([t('abc')])])
    expectMatches(doc, 'abc', [
      [1, 4],
      [6, 9]
    ])
  })

  it('匹配到段尾：to 落在块边界（TextSelection 仍合法）', () => {
    const doc = makeDoc([p([t('雾')])])
    expectMatches(doc, '雾', [[1, 2]])
  })

  it('字面匹配：特殊字符不当正则', () => {
    const doc = makeDoc([p([t('a.b 与 ab')])])
    expectMatches(doc, 'a.b', [[1, 4]])
    // 正则语义会误命中 ab，字面查找不会
    expectMatches(doc, 'ab', [[7, 9]])
  })

  it('硬换行打断 run：跨换行不匹配', () => {
    const doc = makeDoc([p([t('雾'), { type: 'hard_break' }, t('港')])])
    expect(findInDoc(doc, '雾港')).toEqual([])
    expectMatches(doc, '雾', [[1, 2]])
    expectMatches(doc, '港', [[3, 4]])
  })

  it('非重叠匹配（与 macOS 原生 Find 一致）：oo 在 foooo 只命中 1 处', () => {
    const doc = makeDoc([p([t('fooo')])])
    // 命中 index1 后从其后继续搜索（非重叠），仅 1 处
    expectMatches(doc, 'oo', [[2, 4]])
  })
})
