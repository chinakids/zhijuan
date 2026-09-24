import type { EditorState, Transaction } from 'prosemirror-state'
import { Fragment } from 'prosemirror-model'
import type { FindPos } from './finder'

/**
 * 正文查找替换纯逻辑（macOS 文本应用 Find & Replace 语义；TextEdit/Pages/VS Code 同基线）。
 *
 * - 单次替换：text 替换 [from,to)；插入文本沿用 from 位置原格式（resolve(from).marks()，
 *   与 TextEdit「替换文本继承被替换区间起始样式」的行为一致）。
 * - 全部替换：同一事务内『从后往前』逐条 replace——后面位置的替换不会扰动更靠前匹配的
 *   绝对坐标（事务步骤顺序应用，前面的 from/to 始终有效），一次 dispatch 即一条撤销记录
 *   （TextEdit「全部替换」同为单条 undo）。matches 必须来自同一 doc（findInDoc(state.doc)）。
 * - text 为空 = 删除该区间（content 传 Fragment.empty，避免空文本节点）。
 */

export function replaceOne(state: EditorState, from: number, to: number, text: string): Transaction {
  const tr = state.tr
  const marks = state.doc.resolve(from).marks()
  tr.replaceWith(from, to, text !== '' ? state.schema.text(text, marks) : Fragment.empty)
  return tr
}

export function replaceAll(state: EditorState, matches: FindPos[], text: string): Transaction {
  const tr = state.tr
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    const marks = state.doc.resolve(m.from).marks()
    tr.replaceWith(m.from, m.to, text !== '' ? state.schema.text(text, marks) : Fragment.empty)
  }
  return tr
}
