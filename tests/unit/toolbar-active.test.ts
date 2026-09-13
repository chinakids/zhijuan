import { describe, expect, it } from 'vitest'
import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import {
  EMPTY_ACTIVE,
  activeEq,
  readToolbarActive,
  type ActiveState
} from '../../src/renderer/src/features/editor/toolbarActive'

// 与 Milkdown commonmark 预设同构的最小 schema（激活态读取只依赖节点/标记类型名与 heading.level）。
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
    blockquote: { content: 'block+', group: 'block' },
    bullet_list: { content: 'list_item+', group: 'block' },
    ordered_list: { content: 'list_item+', group: 'block' },
    list_item: { content: 'block+' },
    text: { group: 'inline' }
  },
  // 与 Milkdown commonmark 真实命名同构（emphasis / inlineCode——别写成 em / code）
  marks: { strong: {}, emphasis: {}, inlineCode: {} }
})

function docOf(content: unknown) {
  return schema.nodeFromJSON({ type: 'doc', content })
}
const p = (content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, marks })
const li = (content: unknown[]) => ({ type: 'list_item', content })

/** 把选区放到「needle 首次出现」字符内部（textContent 定位，各用例单段文本不歧义） */
function stateAt(doc: ReturnType<typeof docOf>, needle: string, storedMarksSet = false): any {
  const idx = doc.textContent.indexOf(needle)
  const pos = idx + 2 // 字符内（findInDoc 同基线：首文本首字符前 = pos 1）
  const selection = TextSelection.near(doc.resolve(pos))
  return EditorState.create({
    schema,
    doc,
    selection,
    storedMarks: storedMarksSet ? [schema.marks.strong.create()] : undefined
  })
}

describe('readToolbarActive（工具栏激活态纯函数）', () => {
  it('普通段落：block=paragraph 且无 marks', () => {
    const st = stateAt(docOf([p([t('普通文本')])]), '通')
    expect(readToolbarActive(st)).toEqual({
      marks: { strong: false, em: false, code: false },
      block: 'paragraph'
    })
  })

  it('加粗/斜体/行内码（光标在标记字符内）', () => {
    const st = stateAt(
      docOf([p([t('加粗字', [{ type: 'strong' }])])]),
      '粗'
    )
    expect(readToolbarActive(st).marks.strong).toBe(true)
    const st2 = stateAt(docOf([p([t('斜体字', [{ type: 'emphasis' }])])]), '体')
    expect(readToolbarActive(st2).marks.em).toBe(true)
    const st3 = stateAt(docOf([p([t('行内码字', [{ type: 'inlineCode' }])])]), '内')
    expect(readToolbarActive(st3).marks.code).toBe(true)
  })

  it('storedMarks（刚按过加粗、未输入）→ strong 激活', () => {
    const st = stateAt(docOf([p([t('普通')])]), '普', true)
    expect(readToolbarActive(st).marks.strong).toBe(true)
  })

  it('标题按 level 区分 h1/h2/h3', () => {
    const h1 = stateAt(docOf([{ type: 'heading', attrs: { level: 1 }, content: [t('大一')] }]), '大')
    expect(readToolbarActive(h1).block).toBe('heading1')
    const h2 = stateAt(docOf([{ type: 'heading', attrs: { level: 2 }, content: [t('大二')] }]), '大')
    expect(readToolbarActive(h2).block).toBe('heading2')
    const h3 = stateAt(docOf([{ type: 'heading', attrs: { level: 3 }, content: [t('大三')] }]), '大')
    expect(readToolbarActive(h3).block).toBe('heading3')
  })

  it('引用块：光标在块内段落 → blockquote', () => {
    const st = stateAt(docOf([{ type: 'blockquote', content: [p([t('引用的话')])] }]), '引')
    expect(readToolbarActive(st).block).toBe('blockquote')
  })

  it('列表：光标在列表项内段落 → 命中列表容器（非 paragraph）', () => {
    const ul = stateAt(docOf([{ type: 'bullet_list', content: [li([p([t('无序项')])])] }]), '无')
    expect(readToolbarActive(ul).block).toBe('bullet_list')
    const ol = stateAt(docOf([{ type: 'ordered_list', content: [li([p([t('有序项')])])] }]), '有')
    expect(readToolbarActive(ol).block).toBe('ordered_list')
  })

  it('异常输入：null / 无 selection / 无 $from → 全灭且不抛错', () => {
    expect(readToolbarActive(null)).toBe(EMPTY_ACTIVE)
    expect(readToolbarActive({})).toBe(EMPTY_ACTIVE)
    expect(readToolbarActive({ selection: null })).toBe(EMPTY_ACTIVE)
  })

  it('activeEq 比较语义正确', () => {
    const a: ActiveState = { marks: { strong: true, em: false, code: false }, block: 'paragraph' }
    const b: ActiveState = { marks: { strong: true, em: false, code: false }, block: 'paragraph' }
    const c: ActiveState = { marks: { strong: true, em: false, code: false }, block: 'heading1' }
    expect(activeEq(a, b)).toBe(true)
    expect(activeEq(a, c)).toBe(false)
  })
})
