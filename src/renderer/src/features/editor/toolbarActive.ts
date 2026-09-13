/**
 * 编辑器工具栏「激活态」读取（Apple HIG：macOS 方形符号按钮可配置为 push/toggle/pop-up 行为
 * ——加粗/斜体/标题等格式工具本质是 toggle，须向用户呈现当前 toggled 状态；
 * HIG Buttons 四态模型含 selected、Toolbars「system defines hover and selection state appearances automatically」；
 * Pages/TextEdit 先例：光标位于该格式内时对应工具呈按压/激活态。
 *
 * 纯函数：给定 ProseMirror EditorState（或结构等价对象），返回当前光标处格式激活快照。
 * 无 React / 无 prosemirror 类型依赖（用 any 结构读取），供 EditorToolbar 与单测共用。
 *
 * 坑（2026-09-14 冒烟实抓）：Milkdown commonmark 的真实类型名是 emphasis / inlineCode / strong
 * （非 em / code）——判定必须用 type.name 匹配（不依赖 schema.marks 的键名，键名是创建方自由定的）。
 */

export interface ActiveState {
  /** 光标处行内标记（storedMarks 优先——正处在「输入即带该标记」的状态） */
  marks: { strong: boolean; em: boolean; code: boolean }
  /** 光标所在块类型（沿 depth 链上溯：列表项内层是 paragraph，须先命中列表容器；null=文档级/未知） */
  block:
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'paragraph'
    | 'blockquote'
    | 'bullet_list'
    | 'ordered_list'
    | null
}

/** 全灭快照（模块级常量引用，便于调用方快速短路） */
export const EMPTY_ACTIVE: ActiveState = { marks: { strong: false, em: false, code: false }, block: null }

export function activeEq(a: ActiveState, b: ActiveState): boolean {
  return (
    a.block === b.block &&
    a.marks.strong === b.marks.strong &&
    a.marks.em === b.marks.em &&
    a.marks.code === b.marks.code
  )
}

/** 读取光标处格式激活状态（state 无 selection 时返回全灭，不抛错） */
export function readToolbarActive(state: any): ActiveState {
  if (!state?.selection) return EMPTY_ACTIVE
  const { $from } = state.selection
  if (!$from) return EMPTY_ACTIVE

  const marks = state.storedMarks ?? $from.marks()
  const hasMark = (name: string) => marks.some((m: any) => m?.type?.name === name)
  const marksOut: ActiveState['marks'] = {
    strong: hasMark('strong'),
    em: hasMark('emphasis'),
    code: hasMark('inlineCode')
  }

  // 块类型：沿 $from 的 depth 链上溯到 doc（PM Node 无 parent 指针，须用 ResolvedPos.node(depth)），
  // 命中最近的块级目标（heading/blockquote/列表容器）。
  // 段落是载体（列表项内、引用块内的直接子节点都是 paragraph），须越过它找容器；
  // 上溯结束仍未命中容器但路径上出现过 paragraph → 普通段落。
  let sawPara = false
  let block: ActiveState['block'] = null
  for (let d = $from.depth; d >= 1; d--) {
    const name: string = $from.node(d)?.type?.name ?? ''
    if (name === 'heading') {
      const lvl = Number($from.node(d).attrs?.level ?? 0)
      block = lvl === 2 ? 'heading2' : lvl === 3 ? 'heading3' : 'heading1'
      break
    }
    if (name === 'blockquote') {
      block = 'blockquote'
      break
    }
    if (name === 'bullet_list') {
      block = 'bullet_list'
      break
    }
    if (name === 'ordered_list') {
      block = 'ordered_list'
      break
    }
    if (name === 'paragraph') sawPara = true
  }
  if (!block && sawPara) block = 'paragraph'

  return { marks: marksOut, block }
}
