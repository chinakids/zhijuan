/**
 * macOS 标准文本编辑键位补齐（2026-09-18 体验层 · 候选：文本编辑键位与选择体验走查）
 *
 * 服务问题：中文作者高频键位 Cmd+←/→（行首/行尾）、Cmd+↑/↓（文档首/尾）、
 * Shift+Cmd+^/+$（扩选）、Cmd+Backspace（删到行首）——实测 Blink（Chromium/
 * Electron 内核）contenteditable 与原生 textarea 均未把 Cmd 组合路由到编辑命令
 * （对照：无修饰 Home/End 触发 move 命令而 Cmd+Arrow 零行为；Alt/Ctrl 系正常），
 * ProseMirror 官方 baseKeymap 也明确把移动键交给浏览器（macBaseKeymap 只补
 * Ctrl-h/d/a/e、Alt-Backspace 等，无一箭头键）。故织卷在 PM keymap 层
 * （JS 路由、行为确定、可测试）自行绑定 Cmd 系，不依赖 Blink 版本行为。
 *
 * 依据：Apple HIG Keyboards 标准快捷键表（2025-06-09 版实抓）——Shift-Cmd-←/→
 * 「Extend selection to the next/previous semantic unit, typically the end/
 * beginning of the current line」、Shift-Cmd-↑/↓ 「…beginning/end of the
 * document」；macOS TextEdit 标准键位：Cmd-←/→ 行首/行尾、Cmd-↑/↓ 文档首/尾、
 * Cmd-Delete 删到行首、Opt-Delete 删词。
 *
 * 行=可视化行（软换行段内行）；段末（textblock 尾）即最后一行行尾，两类边界一致。
 * 词级移动/删除（Opt-←/→/Delete）Blink 原生按 ICU 词边界可用（实测中文亦有效），
 * 不覆盖。零新依赖（prosemirror-keymap 为 Milkdown 既有依赖）。
 */
import { keymap } from 'prosemirror-keymap'
import { TextSelection } from 'prosemirror-state'
import { deleteSelection } from 'prosemirror-commands'
import type { EditorView } from 'prosemirror-view'

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iP(hone|od|ad)/.test(navigator.platform ?? '')

type CoordAt = (pos: number) => { top: number } | null

/**
 * 从 from 沿 dir 步进，返回与 from 同一「可视行」（coordAt(pos).top 相同）的边界位置：
 * dir=1→行尾、dir=-1→行首。coordAt 不可用（空段/异常）时原样返回。
 * 纯函数（coordAt 注入），单元测试依赖此设计。
 */
export function lineBoundaryPos(
  from: number,
  dir: 1 | -1,
  blockStart: number,
  blockEnd: number,
  coordAt: CoordAt
): number {
  const start = coordAt(from)
  if (!start) return from
  const top = start.top
  let pos = from
  for (let guard = 0; guard < 4096; guard++) {
    const np = pos + dir
    if (np < blockStart || np > blockEnd) break
    const c = coordAt(np)
    if (!c || Math.abs(c.top - top) > 1.5) break
    pos = np
  }
  return pos
}

const safeCoord =
  (view: EditorView): CoordAt =>
  (pos) => {
    try {
      const c = view.coordsAtPos(pos)
      return c && typeof c.top === 'number' ? { top: c.top } : null
    } catch {
      return null
    }
  }

function lineMove(view: EditorView, dir: 1 | -1, extend: boolean): boolean {
  const { state } = view
  const sel = state.selection
  if (!(sel instanceof TextSelection)) return false
  // 行移动严格限于当前 textblock（段首/段末即最后一行行首/行尾；跨 textblock 不是行移动）。
  // 防御：无论扫描如何，结果夹在 block [start,end] 内（blockStart 语义随 resolve 深度而变，不依赖其值）。
  const $h = state.doc.resolve(sel.head)
  const blockStart = $h.start($h.depth)
  const blockEnd = $h.end($h.depth)
  // 关键：head 已处于 textblock 边界时无需扫描（coordsAtPos 对段末 pos 会返回下一块的坐标，
  // 若仍扫描将泄漏到相邻段）；边界=行边界，直接按无操作处理。
  const raw =
    (dir === 1 && sel.head >= blockEnd) || (dir === -1 && sel.head <= blockStart)
      ? sel.head
      : lineBoundaryPos(sel.head, dir, blockStart, blockEnd, safeCoord(view))
  const target = dir === 1 ? Math.min(raw, blockEnd) : Math.max(raw, blockStart)
  // 已到边界=无操作，但必须 return true 拦截传播：Blink 原生会抢接（实测合成 Backspace
  // 在 keymap 放行后被 deleteWordBackward 接管并误删相邻词），mac 标准=停在边界不动。
  if (target === sel.head) return true
  const tr = extend
    ? state.tr.setSelection(TextSelection.create(state.doc, sel.anchor, target))
    : state.tr.setSelection(TextSelection.create(state.doc, target))
  view.dispatch(tr.scrollIntoView())
  return true
}

function docEdge(view: EditorView, atEnd: boolean, extend: boolean): boolean {
  const { state } = view
  const sel = state.selection
  if (!(sel instanceof TextSelection)) return false
  const target = atEnd ? state.doc.content.size : 0
  // 已到文档边界：return true 拦截（同上，防 Blink 原生抢接）
  if (sel.head === target) return true
  const tr = extend
    ? state.tr.setSelection(TextSelection.create(state.doc, sel.anchor, target))
    : state.tr.setSelection(TextSelection.create(state.doc, target))
  view.dispatch(tr.scrollIntoView())
  return true
}

function deleteToLineStart(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection
  if (!(sel instanceof TextSelection)) return false
  if (!sel.empty) return deleteSelection(state, view.dispatch)
  const $h = state.doc.resolve(sel.head)
  const blockStart = $h.start($h.depth)
  const blockEnd = $h.end($h.depth)
  // 防御同上：起点夹在 block [start,end] 内，绝不跨段删除/合并相邻段
  // head 已在段首=行首，无需扫描（同上，防 coordsAtPos 边界坐标泄漏）
  const raw =
    sel.head <= blockStart
      ? sel.head
      : lineBoundaryPos(sel.head, -1, blockStart, blockEnd, safeCoord(view))
  const start = Math.max(raw, blockStart)
  // 已到行首=无操作，return true 拦截（防 Blink 原生 deleteWordBackward 抢接）
  if (start >= sel.head) return true
  view.dispatch(state.tr.delete(start, sel.head))
  return true
}

/** mac 平台专属：Cmd 系标准文本编辑键位（其他平台返回 null，走 Blink 原生）。 */
export const macTextKeysPlugin = IS_MAC
  ? keymap({
      'Mod-ArrowLeft': (_s, _d, view) => (view ? lineMove(view, -1, false) : false),
      'Mod-ArrowRight': (_s, _d, view) => (view ? lineMove(view, 1, false) : false),
      'Shift-Mod-ArrowLeft': (_s, _d, view) => (view ? lineMove(view, -1, true) : false),
      'Shift-Mod-ArrowRight': (_s, _d, view) => (view ? lineMove(view, 1, true) : false),
      'Mod-ArrowUp': (_s, _d, view) => (view ? docEdge(view, false, false) : false),
      'Mod-ArrowDown': (_s, _d, view) => (view ? docEdge(view, true, false) : false),
      'Shift-Mod-ArrowUp': (_s, _d, view) => (view ? docEdge(view, false, true) : false),
      'Shift-Mod-ArrowDown': (_s, _d, view) => (view ? docEdge(view, true, true) : false),
      'Mod-Backspace': (_s, _d, view) => (view ? deleteToLineStart(view) : false)
    })
  : null
