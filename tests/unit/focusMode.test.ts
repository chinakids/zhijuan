import { describe, expect, it } from 'vitest'
import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { focusBlockRange } from '../../src/renderer/src/features/editor/focusMode'

// 与 Milkdown commonmark 预设同构的最小 schema（焦点块判定只依赖块结构）。
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
    blockquote: { content: 'block+', group: 'block' },
    bullet_list: { content: 'list_item+', group: 'block' },
    list_item: { content: 'block+' },
    text: { group: 'inline' }
  },
  marks: { strong: {} }
})

function docOf(content: unknown) {
  return schema.nodeFromJSON({ type: 'doc', content })
}
const p = (content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string) => ({ type: 'text', text })
const li = (content: unknown[]) => ({ type: 'list_item', content })

/** 光标放在 needle 首字符前（pos = idx+1 已在段内文本前），返回 EditorState */
function stateAt(doc: ReturnType<typeof docOf>, needle: string) {
  const idx = doc.textContent.indexOf(needle)
  const pos = idx + 1
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.near(doc.resolve(pos))
  })
}

/** 顶层块 range 辅助：从 0 起累计 nodeSize 得第 k 个顶层块 [from,to) */
function blockRange(doc: ReturnType<typeof docOf>, k: number) {
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const n = doc.child(i)
    const from = pos
    pos += n.nodeSize
    if (i === k) return { from, to: pos }
  }
  return null
}

describe('focusBlockRange（焦点模式当前块判定纯函数）', () => {
  const doc = docOf([
    p([t('第一段：潮声从码头那头传过来。')]),
    p([t('第二段：她数着水痕，等天亮。')]),
    p([t('第三段：风把灯吹灭了。')])
  ])

  it('光标在中间段 → 返回该段范围（其余段将被淡化）', () => {
    const st = stateAt(doc, '数着')
    expect(focusBlockRange(st)).toEqual(blockRange(doc, 1))
  })

  it('光标在首段 → 返回首段', () => {
    const st = stateAt(doc, '潮声')
    expect(focusBlockRange(st)).toEqual(blockRange(doc, 0))
  })

  it('选区跨两段 → null（不淡化，整体选择不干扰）', () => {
    const st = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, blockRange(doc, 0)!.to - 6, blockRange(doc, 1)!.from + 6)
    })
    expect(focusBlockRange(st)).toBeNull()
  })

  it('空段（唯一块）→ 返回该段（淡化后无其它块，视觉等价不淡化）', () => {
    const empty = docOf([p([])])
    const st = EditorState.create({ schema, doc: empty, selection: TextSelection.near(empty.resolve(0)) })
    expect(focusBlockRange(st)).toEqual(blockRange(empty, 0))
  })

  it('标题块 → 返回标题范围', () => {
    const h = docOf([
      { type: 'heading', attrs: { level: 1 }, content: [t('第一章')] },
      p([t('正文第一段。')])
    ])
    const st = stateAt(h, '第一章')
    expect(focusBlockRange(st)).toEqual(blockRange(h, 0))
  })

  it('列表内 → 整列表为焦点块（非逐 li）', () => {
    const l = docOf([
      p([t('引言。')]),
      { type: 'bullet_list', content: [li([p([t('甲')])]), li([p([t('乙')])])] }
    ])
    const st = stateAt(l, '乙')
    expect(focusBlockRange(st)).toEqual(blockRange(l, 1))
  })

  it('引用块内 → 整引用块为焦点块', () => {
    const q = docOf([{ type: 'blockquote', content: [p([t('他说：天亮前到。')])] }, p([t('后记。')])])
    const st = stateAt(q, '天亮前')
    expect(focusBlockRange(st)).toEqual(blockRange(q, 0))
  })
})
