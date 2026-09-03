import { useEffect, useRef, type MutableRefObject } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { setBlockType, toggleMark } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history'
import '@milkdown/theme-nord/style.css'
import '../../styles/milkdown.css'
import { cn } from '../../lib/utils'

/** 暴露给父组件的命令式 API */
export interface ProseApi {
  getMarkdown(): string
  getSelected(): string | null
  applyMarkdown(md: string, replaceSel: boolean): void
  setContent(md: string): void
  focus(): void
  destroy(): void
}

interface ProseProps {
  /** 初始内容（仅首挂载生效；换文件用 key 重建） */
  value: string
  onEdit?: (md: string) => void
  apiRef?: MutableRefObject<ProseApi | null>
  className?: string
}

interface WinWithEditors {
  __ZJ_TEST?: boolean
  __ZJ_EDITORS?: ProseApi[]
}

/* ---------- 轻量工具栏（prosemirror 命令，所见即所得） ---------- */
type EditorLike = { action: (fn: (ctx: any) => void) => void }
function Toolbar({ edRef }: { edRef: MutableRefObject<EditorLike | null> }) {
  const run = (fn: (view: any, schema: any) => void) => {
    const e = edRef.current
    if (!e) return
    try {
      e.action((ctx: any) => {
        const view = ctx.get(editorViewCtx)
        fn(view, view.state.schema)
        view.focus()
      })
    } catch {
      /* 编辑器还没就绪时点击直接忽略 */
    }
  }
  const B = (label: string, title: string, onClick: () => void) => (
    <button key={label} title={title} className="font-medium" onClick={onClick}>
      {label}
    </button>
  )
  const Sep = <span key="s" className="sep" />
  return (
    <div className="zj-md-toolbar">
      {B('H1', '一级标题', () => run((v, s) => setBlockType(s.nodes.heading, { level: 1 })(v.state, v.dispatch)))}
      {B('H2', '二级标题', () => run((v, s) => setBlockType(s.nodes.heading, { level: 2 })(v.state, v.dispatch)))}
      {B('H3', '三级标题', () => run((v, s) => setBlockType(s.nodes.heading, { level: 3 })(v.state, v.dispatch)))}
      {B('¶', '正文段落', () => run((v, s) => setBlockType(s.nodes.paragraph)(v.state, v.dispatch)))}
      {Sep}
      {B('B', '加粗', () => run((v, s) => toggleMark(s.marks.strong)(v.state, v.dispatch)))}
      {B('I', '斜体', () => run((v, s) => toggleMark(s.marks.em)(v.state, v.dispatch)))}
      {B('`<>`', '行内代码', () => run((v, s) => toggleMark(s.marks.code)(v.state, v.dispatch)))}
      {B('“”', '引用块', () => run((v, s) => setBlockType(s.nodes.blockquote)(v.state, v.dispatch)))}
      {B('•', '无序列表', () => run((v, s) => wrapInList(s.nodes.bullet_list)(v.state, v.dispatch)))}
      {B('1.', '有序列表', () => run((v, s) => wrapInList(s.nodes.ordered_list)(v.state, v.dispatch)))}
      {Sep}
      {B('↶', '撤销', () => run((v) => undo(v.state, v.dispatch)))}
      {B('↷', '重做', () => run((v) => redo(v.state, v.dispatch)))}
    </div>
  )
}

const win = (typeof window !== 'undefined' ? window : {}) as WinWithEditors

function testRegister(api: ProseApi) {
  if (!win.__ZJ_TEST) return
  ;(win.__ZJ_EDITORS ??= []).push(api)
}
function testUnregister(api: ProseApi) {
  if (!win.__ZJ_TEST) return
  const a = win.__ZJ_EDITORS
  if (!a) return
  const i = a.indexOf(api)
  if (i >= 0) a.splice(i, 1)
}

export default function Prose({ value, onEdit, apiRef, className }: ProseProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const initialRef = useRef<string>(value)
  const onEditRef = useRef(onEdit)
  onEditRef.current = onEdit
  const liveRef = useRef(true)
  const edRef = useRef<any>(null) // Milkdown Editor 实例（工具栏用）

  useEffect(() => {
    if (!hostRef.current) return
    let api: ProseApi | null = null
    liveRef.current = true
    const ed = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, hostRef.current!)
        ctx.set(defaultValueCtx, initialRef.current)
        ctx.get(listenerCtx).markdownUpdated((_, md) => {
          if (!liveRef.current) return
          onEditRef.current?.(md)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(cursor)
      .use(clipboard)
      .use(trailing)
      .create()
    ed.then((e) => {
      edRef.current = e
      if (!liveRef.current) {
        e.destroy()
        return
      }
      api = {
        getMarkdown: () => e.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
        getSelected: () =>
          e.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const { from, to, empty } = view.state.selection
            if (empty) return null
            return view.state.doc.textBetween(from, to, '\n')
          }),
        applyMarkdown: (md, replaceSel) =>
          e.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const parser = ctx.get(parserCtx)
            const doc = parser(md)
            const { from, to, empty } = view.state.selection
            let tr = view.state.tr
            if (replaceSel && !empty) tr = tr.replaceWith(from, to, doc)
            else tr = tr.insert(from, doc)
            view.dispatch(tr)
            view.focus()
          }),
        setContent: (md) =>
          e.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const parser = ctx.get(parserCtx)
            const doc = parser(md)
            view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc))
          }),
        focus: () => e.action((ctx) => ctx.get(editorViewCtx).focus()),
        destroy: () => e.destroy()
      }
      if (apiRef) apiRef.current = api
      testRegister(api)
    })
    return () => {
      liveRef.current = false
      if (api) {
        if (apiRef) apiRef.current = null
        testUnregister(api)
        api.destroy()
        api = null
      }
      edRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={cn('zj-md flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-hair', className)}>
      <Toolbar edRef={edRef} />
      <div ref={hostRef} className="min-h-0 flex-1 overflow-y-auto" />
    </div>
  )
}

export type { ProseProps }
