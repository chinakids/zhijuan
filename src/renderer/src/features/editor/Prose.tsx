import { useEffect, useRef, type MutableRefObject } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { trailing } from '@milkdown/kit/plugin/trailing'
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className={cn('h-full w-full', className)} />
}

export type { ProseProps }
