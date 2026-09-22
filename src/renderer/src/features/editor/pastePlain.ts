/**
 * 正文编辑器「粘贴为纯文本」（2026-09-23 创作层 · 自发现主题：「粘贴即毁格式」）
 *
 * 服务创作/产品问题：小说作者把素材/旧稿/网页/聊天文本粘进正文是高频动作；现状
 * Milkdown clipboard 插件（@milkdown/plugin-clipboard v7.22.1）在剪贴板无 text/html
 * 时把 text/plain 交给 markdown 解析器（handlePaste: parser(text)）——行首 `#`/`>`/`-`/`1.`
 * 等 markdown 特征字符会被解析成标题/引用/列表，「粘贴即毁格式」，作者须手动改回。
 *
 * 对照范式（真实抓取，来源见 02-创作层.md 本轮日志）：
 * - Obsidian 官方 Editing shortcuts（help.obsidian.md/Editing+shortcuts，CDP 实抓）：
 *   「Paste without formatting」= Cmd+Shift+V（macOS）/ Ctrl+Shift+V——业界标准=默认
 *   按格式粘贴不变，另给显式无格式快捷键。织卷同构：Cmd+V 保持 Milkdown 原行为，
 *   Cmd+Shift+V 走本插件；右键菜单另设「粘贴为纯文本」入口。
 * - ProseMirror（prosemirror-view）原生已内置 Shift+粘贴=纯文本语义：keydown 追踪
 *   view.input.shiftKey（dist/index.js:3191/3354），doPaste 以 preferPlain 让
 *   parseFromClipboard 生成纯文本 slice 后传给 handlePaste 钩子——但 Milkdown 的
 *   clipboard 插件在「仅 text/plain 无 html」分支**忽略该 slice**、自行 markdown 解析
 *   （plugin-clipboard lib/index.js:83-86），原生纯文本语义被短路。本插件在
 *   prosePluginsCtx 中先于 clipboard 注册（Prose.tsx），Shift 分支接管并透传 PM
 *   已纯文本化的 slice（fallback 自建字面 slice），其余按键原样放行=Milkdown 默认零改动。
 *
 * 实现口径：无格式粘贴=文本按「字面」进入正文——空行分段成 paragraph、段内换行用
 * hardbreak 节点（与输入层硬换行同节点，不经 markdown 解析）。`# 标题` 等以纯文本
 * 节点进入，Milkdown 序列化走 remark-stringify（@milkdown/transformer 依赖 remark
 * ^15）——结构字符由序列化器自动转义，保存→重新加载往返一致（字面文本不被解析成格式）。
 *
 * 边界（与 Milkdown 原 clipboard 插件对齐）：选区在 code 节点（spec.code）内不接管
 * （系统默认粘贴本就纯文本，且 paragraph 结构塞不进 code_block）；shiftKey 未按 /
 * 剪贴板无文本 / 编辑器只读均不接管。
 */
import { Fragment } from 'prosemirror-model'
import { Slice } from 'prosemirror-model'
import type { Node as PMNode, Schema } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

/** 纯函数：普通文本 → 段落字符串数组（空行=段落分隔；\r\n/\r 归一为 \n；连续空行只分一段）。 */
export function splitPlainParagraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const paras: string[] = []
  let cur: string[] = []
  for (const ln of lines) {
    if (ln === '') {
      if (cur.length) {
        paras.push(cur.join('\n'))
        cur = []
      }
    } else {
      cur.push(ln)
    }
  }
  if (cur.length) paras.push(cur.join('\n'))
  return paras
}

/** 纯函数：段落数组 → ProseMirror Slice（paragraph + text + hardbreak）。 */
export function plainTextSlice(paras: string[], schema: Schema): Slice | null {
  const paragraph = schema.nodes.paragraph
  const hardBreak = schema.nodes.hardbreak
  if (!paragraph) return null
  const blocks: PMNode[] = []
  for (const p of paras) {
    const content: PMNode[] = []
    const lines = p.split('\n')
    lines.forEach((ln, i) => {
      if (i > 0) {
        // 段内换行：优先 hardbreak；schema 无 hardbreak 时退化为空格分隔
        content.push(hardBreak ? hardBreak.create() : schema.text(' '))
      }
      if (ln) content.push(schema.text(ln))
    })
    if (!content.length) content.push(schema.text(''))
    blocks.push(paragraph.create(null, content))
  }
  if (!blocks.length) return null
  return new Slice(Fragment.from(blocks), 0, 0)
}

/**
 * handlePaste：Cmd/Ctrl+Shift+V（ProseMirror view.input.shiftKey 内建检测）时按字面
 * 插入纯文本，返回 true 吞掉默认。slice 语义统一为本插件口径（空行分段+段内 hardbreak），
 * 不用 PM 入参 slice（PM preferPlain 把每个换行拆成单独段落，与本插件的「段内硬换行」
 * 语义不一致，会把粘贴的软换行文本切碎成大量段落）。
 */
export function handlePlainPaste(view: EditorView, event: ClipboardEvent): boolean {
  // ProseMirror 原生「Shift+粘贴=纯文本」判定即 view.input.shiftKey（keydown 追踪，
  // dist/index.js:3191/3354、doPaste preferPlain:3737）；类型未公开，按内部契约访问，
  // 与 PM 自身判定同源（跨版本改名风险小——该字段自 prosemirror-view 早期即稳定）。
  const inputState = (view as unknown as { input?: { shiftKey?: boolean } }).input
  if (!inputState?.shiftKey) return false
  if (view.props.editable?.(view.state) === false) return false
  const { clipboardData } = event
  if (!clipboardData) return false
  const selNode = view.state.selection.$from.node()
  if (selNode.type.spec.code) return false
  const text = clipboardData.getData('text/plain')
  if (!text && !clipboardData.getData('text/html')) return false
  const slice = plainTextSlice(splitPlainParagraphs(text), view.state.schema)
  if (!slice) return false
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
  return true
}

/** ProseMirror 插件：Shift+粘贴走字面文本（零依赖，与 macTextKeysPlugin 同走 prosePluginsCtx）。 */
export const pastePlainPlugin = new Plugin({
  props: {
    handlePaste: handlePlainPaste
  }
})
