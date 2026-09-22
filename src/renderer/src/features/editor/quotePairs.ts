/**
 * 正文编辑器「中文引号自动成对」（2026-09-23 创作层 · 自发现主题）
 *
 * 服务创作/产品问题：中文小说正文以对话为主体，全角弯引号 “ ” 是最高频输入字符。
 * 现状=框架默认（Milkdown/ProseMirror）对中文引号无任何成对逻辑：输入一个 “ 就
 * 只得到一个 “，作者须手工补 ” ——每句对话两次多击，且漏补闭引号是常见低级错误。
 *
 * 对照范式（调研取证，来源见 02-创作层.md 本轮日志）：
 * - CodeMirror 6 @codemirror/autocomplete closebrackets（api.github.com 直抓源码核）：
 *   默认 brackets 仅 ASCII ["(", "[", "{", "'", '"']；closing() 对非 ASCII 自动 +1
 *   （U+201C “ → U+201D ”），即把 "“" 加入配置即可支持——但 inputHandler **显式
 *   跳过 IME 组合期**（view.compositionStarted 时 return false），即 CM 官方取舍：
 *   组合期不自动闭合。同时「输入开引号且后一字符已是闭引号 → 仅插开引号（光标落在
 *   闭引号前=跳过语义）」「输入闭引号且后一字符已是闭引号 → 跳过不重复」。
 * - Obsidian 设置「Automatically pair brackets」即 CM closeBrackets（同源）。
 * - Word/WPS（文档应用层）对全角引号无脑自动成对（IME 路径也生效）——中文写作场景
 *   的主流期待；织卷作为小说工作台取 Word 同款行为，且**必须双路**：
 *   ① 直接输入路径（handleTextInput，beforeinput insertText）——桌面中文输入法输
 *      入标点时多为直接提交，走此路；
 *   ② IME 组合路径（compositionend 后检查光标前字符）——组合期提交以 “ 结尾时兜底
 *      （与 CM 不同：CM 放弃、织卷接管，代价=上一件 0ms 微任务判断，不干扰选字）。
 *
 * 行为口径（Word 同款等价、可预期）：
 * - 输入 “（U+201C）：后一字符不是 ” → 插入 “”，光标留在两引号之间；
 *   后一字符已是 ” → 仅插 “，光标落在 ” 之前（不产生多余成对）。
 * - 输入 ”（U+201D）：后一字符已是 ” → 跳过（光标移到该 ” 之后，不插新字符）；
 *   否则正常输入单个 ”。
 * - 其它字符、多字符输入、只读、选区非空：一律放行（零干扰）。
 * - 范围刻意最小：仅 ”“ 两字符（小说对话高频）；全角书名号《》／单引号 ‘ ’ 等
 *   登记观察项，无真实诉求不扩（同 CM/Qt 最小原则）。
 */
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

export const QUOTE_OPEN = '\u201C' // “
export const QUOTE_CLOSE = '\u201D' // ”

export type QuoteStep =
  | { type: 'insert-pair' }
  | { type: 'insert-open' }
  | { type: 'skip-close' }
  | { type: 'none' }

/**
 * 纯函数：给定「本次输入字符 + 插入点前一字符 + 后一字符」，返回应执行的成对动作。
 * before/after 为 null 表示文档边界处。
 */
export function quoteStepFor(ch: string, before: string | null, after: string | null): QuoteStep {
  if (ch === QUOTE_OPEN) {
    if (after === QUOTE_CLOSE) return { type: 'insert-open' }
    return { type: 'insert-pair' }
  }
  if (ch === QUOTE_CLOSE) {
    if (after === QUOTE_CLOSE) return { type: 'skip-close' }
    return { type: 'none' }
  }
  return { type: 'none' }
}

/** 取 doc 中 pos 前一字符（pos 为 selection head；返回 null=文档首）。 */
export function charBefore(doc: { textBetween(a: number, b: number): string; content: { size: number } }, pos: number): string | null {
  if (pos <= 0) return null
  const prev = doc.textBetween(pos - 1, pos)
  return prev || null
}

/** 取 doc 中 pos 起一字符（返回 null=文档尾）。 */
export function charAfter(doc: { textBetween(a: number, b: number): string; content: { size: number } }, pos: number): string | null {
  if (pos >= doc.content.size) return null
  const next = doc.textBetween(pos, pos + 1)
  return next || null
}

/** 在 view 当前选中/光标处执行成对动作（纯 PM dispatch，无 DOM 依赖）。 */
function applyQuoteStep(view: EditorView, step: QuoteStep): boolean {
  const { state } = view
  const sel = state.selection
  if (!sel.empty) return false // 有选区不动作（覆盖输入即走默认）
  const head = sel.head
  const tr = state.tr
  if (step.type === 'insert-pair') {
    // 插入 "”"并把光标放在二者之间（state 与 doc 均以码元计——全角引号单码元，安全）
    tr.insertText(QUOTE_OPEN + QUOTE_CLOSE, head, head)
    tr.setSelection(TextSelection.create(tr.doc, head + 1))
    view.dispatch(tr)
    return true
  }
  if (step.type === 'insert-open') {
    tr.insertText(QUOTE_OPEN, head, head)
    view.dispatch(tr)
    return true
  }
  if (step.type === 'skip-close') {
    // 光标后已是闭引号：移到它之后（不重复插入）
    tr.setSelection(TextSelection.create(tr.doc, head + 1))
    view.dispatch(tr)
    return true
  }
  return false
}

/**
 * 直接输入路径（非 IME 组合）：ProseMirror handleTextInput。
 * 仅拦截“ ”单字符输入；其余放行（return false）。
 */
function handleQuoteInput(view: EditorView, from: number, to: number, text: string): boolean {
  if (text.length !== 1 || view.props.editable?.(view.state) === false) return false
  const ch = text
  if (ch !== QUOTE_OPEN && ch !== QUOTE_CLOSE) return false
  // from/to 必须与当前光标一致（撤销重做/多段粘贴不在此列——上层已保证单字符才会到）
  const sel = view.state.selection
  if (from !== sel.from || to !== sel.to) return false
  const step = quoteStepFor(ch, charBefore(view.state.doc, from), charAfter(view.state.doc, to))
  if (step.type === 'none') return false
  return applyQuoteStep(view, step)
}

/** 生成「compositionend 后兜底补成对」回调（插件 view 钩子内挂接到 view.dom）。 */
function makeCompositionFallback(view: EditorView): () => void {
  return () => {
    // PM 内部 compositionend 处理是同步的（updateComposition 在自家 DOM listener 中），
    // 本 listener 经插件 view 钩子注册晚于 PM 内部 → 直接用微任务脱离当前事件栈，
    // 待 PM 完成 doc 同步后再检查（不与 PM 内部事务竞态）。
    Promise.resolve().then(() => {
      const { state } = view
      if (view.props.editable?.(state) === false) return
      const sel = state.selection
      if (!sel.empty) return
      const head = sel.head
      // 光标前字符恰为开引号、后一字符不是闭引号 → 补一对（光标留中间）
      const before = charBefore(state.doc, head)
      if (before !== QUOTE_OPEN) return
      const step = quoteStepFor(QUOTE_OPEN, before, charAfter(state.doc, head))
      if (step.type !== 'insert-pair') return
      applyQuoteStep(view, step)
    })
  }
}

/** ProseMirror 插件：中文引号自动成对（零依赖，与 pastePlainPlugin 同走 prosePluginsCtx）。 */
export const quotePairPlugin = new Plugin({
  props: {
    handleTextInput: handleQuoteInput
  },
  view: (view) => {
    const handler = makeCompositionFallback(view)
    view.dom.addEventListener('compositionend', handler)
    return {
      destroy() {
        view.dom.removeEventListener('compositionend', handler)
      }
    }
  }
})
