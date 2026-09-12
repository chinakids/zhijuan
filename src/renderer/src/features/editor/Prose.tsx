import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { selectAll } from 'prosemirror-commands'
import { TextSelection } from 'prosemirror-state'
import '@milkdown/theme-nord/style.css'
import '../../styles/milkdown.css'
import { ClipboardPaste, Copy, MessageSquarePlus, Scissors, TextSelect } from 'lucide-react'
import { cn } from '../../lib/utils'
import EditorToolbar from './EditorToolbar'
import FindBar from './FindBar'
import { findInDoc, type FindPos } from './finder'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../../components/ui/context-menu'

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
  __ZJ_FIND?: {
    open: (q?: string) => void
    close: () => void
    next: () => void
    prev: () => void
    getState: () => { open: boolean; query: string; total: number; current: number }
    goTo: (idx: number) => void
  }
}

type EditorLike = { action: (fn: (ctx: any) => void) => void }
export { type EditorLike }

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

  /* —— 划词浮层：选中文本 → 送进对话引用（全局事件 zj:quote-text）—— */
  const [bubble, setBubble] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    const onSel = () => {
      const host = hostRef.current
      const s = window.getSelection()
      if (!host || !s || s.rangeCount === 0 || s.isCollapsed) {
        setBubble(null)
        return
      }
      const t = s.toString().trim()
      if (!t) {
        setBubble(null)
        return
      }
      const r = s.getRangeAt(0)
      if (!host.contains(r.startContainer) || !host.contains(r.endContainer)) {
        setBubble(null)
        return
      }
      const rect = r.getBoundingClientRect()
      const below = rect.top < 120
      setBubble({ text: t, x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below })
    }
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.('.zj-sel-bubble')) return
      if (!hostRef.current?.contains(e.target as Node)) setBubble(null)
    }
    const onScroll = () => onSel()
    document.addEventListener('selectionchange', onSel)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('selectionchange', onSel)
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])
  const dispatchQuote = () => {
    if (!bubble) return
    window.dispatchEvent(new CustomEvent('zj:quote-text', { detail: bubble.text }))
    setBubble(null)
  }

  /* —— 正文右键菜单（Apple HIG Context menus：上下文相关/≤3 组/隐藏不可用/无快捷键文字）—— */
  const [menuSel, setMenuSel] = useState<string | null>(null)
  const getSelText = (): string | null => {
    // 优先用编辑器模型选区：右键/点按可能让浏览器调整 DOM 选区，但 ProseMirror state 不受右键影响
    let model: string | null = null
    try {
      edRef.current?.action((ctx: any) => {
        const view = ctx.get(editorViewCtx)
        const { from, to } = view.state.selection
        if (from === to) return
        const s = view.state.doc.textBetween(from, to, '\n').trim()
        if (s) model = s
      })
    } catch {
      /* 编辑器未就绪则走 DOM 兜底 */
    }
    if (model) return model
    const host = hostRef.current
    const s = window.getSelection()
    if (!host || !s || s.rangeCount === 0 || s.isCollapsed) return null
    const r = s.getRangeAt(0)
    if (!host.contains(r.startContainer) || !host.contains(r.endContainer)) return null
    const t = s.toString().trim()
    return t || null
  }
  const onMenuOpenChange = (open: boolean) => {
    if (!open) {
      setMenuSel(null)
      return
    }
    // menuSel 已在 contextmenu 捕获阶段快照（右键时 Chromium 会短暂 collapsed DOM 选区，onOpenChange 再读已太晚）
    setBubble(null) // 右键打开菜单时收起划词浮层，避免重叠
  }
  const snapMenuSel = () => setMenuSel(getSelText())
  const runEdit = (fn: (view: any, ctx: any) => void) => {
    const e = edRef.current
    if (!e) return
    try {
      e.action((ctx: any) => {
        const view = ctx.get(editorViewCtx)
        fn(view, ctx)
        view.focus()
      })
    } catch {
      /* 编辑器还没就绪时直接忽略 */
    }
  }
  const writeClip = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* 剪贴板不可用时静默 */
      }
      ta.remove()
    }
  }
  const doCopy = async (text?: string) => {
    const t = text ?? menuSel
    if (!t) return
    await writeClip(t)
  }
  const doCut = async () => {
    if (!menuSel) return
    await writeClip(menuSel)
    runEdit((v) => v.dispatch(v.state.tr.deleteSelection()))
  }
  const doPaste = async () => {
    let t = ''
    try {
      t = await navigator.clipboard.readText()
    } catch {
      return
    }
    if (!t.trim()) return
    runEdit((v, ctx) => {
      const doc = ctx.get(parserCtx)(t)
      const { from, to } = v.state.selection
      v.dispatch(v.state.tr.replaceWith(from, to, doc))
    })
  }
  const doSelectAll = () => runEdit((v) => selectAll(v.state, v.dispatch))
  const doQuote = () => {
    if (menuSel) window.dispatchEvent(new CustomEvent('zj:quote-text', { detail: menuSel }))
  }
  const copyBubble = () => {
    if (!bubble) return
    void doCopy(bubble.text)
    setBubble(null)
  }

  /* —— 文中查找（Apple HIG Keyboards：⌘F / ⌘G / ⇧⌘G / Esc）——
   * 纯前端实现：finder.ts 出匹配位置 → CSS Custom Highlight API 高亮（Chromium 原生，不引插件）
   * → 当前匹配用 TextSelection 选中并滚动（与编辑器真实的选区/光标一致）。
   * 行为口径（对齐 macOS 文本应用）：输入即跳第一处；⌘G/⇧⌘G 循环；Esc 关闭并清高亮（保留搜索词）。
   */
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findCount, setFindCount] = useState({ total: 0, current: -1 })
  const findRef = useRef<{ matches: FindPos[]; current: number }>({ matches: [], current: -1 })
  const findOpenRef = useRef(false)
  const findQueryRef = useRef('')
  findOpenRef.current = findOpen
  findQueryRef.current = findQuery

  const getView = (): any => {
    let v: any = null
    edRef.current?.action((ctx: any) => {
      v = ctx.get(editorViewCtx)
    })
    return v
  }

  const applyFindHighlight = (view: any, matches: FindPos[], current: number) => {
    try {
      const w = window as any
      const css = w.CSS
      if (!css || typeof css.highlights === 'undefined' || typeof w.Highlight === 'undefined') return
      css.highlights.delete('zj-find-hit')
      css.highlights.delete('zj-find-cur')
      if (!matches.length) return
      const hits: Range[] = []
      const curs: Range[] = []
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i]
        const s = view.domAtPos(m.from)
        const e = view.domAtPos(m.to)
        const r = document.createRange()
        try {
          r.setStart(s.node, s.offset)
          r.setEnd(e.node, e.offset)
        } catch {
          continue // 匹配横跨不可取 DOM 的位置（如段尾）时跳过该条高亮，不影响跳转
        }
        ;(i === current ? curs : hits).push(r)
      }
      if (hits.length) css.highlights.set('zj-find-hit', new w.Highlight(...hits))
      if (curs.length) css.highlights.set('zj-find-cur', new w.Highlight(...curs))
    } catch {
      /* 环境不支持高亮时静默：跳转（选中+滚动）仍有效 */
    }
  }

  const jumpTo = (view: any, pos: FindPos) => {
    try {
      const tr = view.state.tr
      tr.setSelection(TextSelection.create(view.state.doc, pos.from, pos.to))
      tr.scrollIntoView()
      view.dispatch(tr)
    } catch {
      /* 位置非法（理论不应发生）时忽略 */
    }
  }

  const recalcFind = (query: string, jump: boolean) => {
    const view = getView()
    if (!view) return
    const matches = query.trim() ? findInDoc(view.state.doc, query.trim()) : []
    let cur = -1
    if (matches.length) {
      // jump：定位第一处；否则（编辑中）clamp 保持原序号，不挪动用户光标
      cur = jump ? 0 : Math.min(Math.max(findRef.current.current, 0), matches.length - 1)
    }
    findRef.current = { matches, current: cur }
    applyFindHighlight(view, matches, cur)
    if (jump && matches.length) jumpTo(view, matches[cur])
    setFindCount({ total: matches.length, current: cur })
  }
  const recalcRef = useRef(recalcFind)
  recalcRef.current = recalcFind

  const openFind = () => {
    const view = getView()
    if (!view) return
    const sel = view.state.selection
    let pre = ''
    if (!sel.empty) pre = view.state.doc.textBetween(sel.from, sel.to, '\n')
    if (!pre.trim()) pre = findQueryRef.current
    setFindOpen(true)
    setFindQuery(pre)
    recalcFind(pre, true)
  }

  const closeFind = () => {
    const view = getView()
    if (view) applyFindHighlight(view, [], -1)
    findRef.current = { matches: [], current: -1 }
    setFindOpen(false)
    setFindCount({ total: 0, current: -1 })
  }

  const stepFind = (dir: 1 | -1) => {
    const view = getView()
    const st = findRef.current
    if (!view || !st.matches.length) return
    const n = st.matches.length
    let cur = st.current + dir
    if (cur >= n) cur = 0
    else if (cur < 0) cur = n - 1
    st.current = cur
    applyFindHighlight(view, st.matches, cur)
    jumpTo(view, st.matches[cur])
    setFindCount({ total: n, current: cur })
  }

  const goTo = (idx: number) => {
    const view = getView()
    const st = findRef.current
    if (!view || !st.matches.length) return
    const cur = ((idx % st.matches.length) + st.matches.length) % st.matches.length
    st.current = cur
    applyFindHighlight(view, st.matches, cur)
    jumpTo(view, st.matches[cur])
    setFindCount({ total: st.matches.length, current: cur })
  }

  /* ⌘E（HIG Keyboards：E = Use the selection for a find operation）——用模型选区设置查找词：
   * 不开查找条（原生语义），刷新高亮并定位第一处作反馈；无选区 → no-op；⌘G/⇧⌘G 紧接着可用。 */
  const setFindFromSelection = () => {
    const view = getView()
    if (!view) return
    const sel = view.state.selection
    if (sel.empty) return
    const t = view.state.doc.textBetween(sel.from, sel.to, '\n').trim()
    if (!t) return
    setFindQuery(t)
    findQueryRef.current = t
    recalcFind(t, true)
  }

  /* 全局快捷键：⌘F 打开查找（预填选区/上次词）、⌘E 用选区设查找词、⌘G/⇧⌘G 下一处/上一处、
   * Esc 关闭（查找条开，或 ⌘E 设置后有活跃高亮/匹配时都拦截——结束本次查找）。 */
  const findActionsRef = useRef({ open: openFind, close: closeFind, step: stepFind, useSel: setFindFromSelection })
  findActionsRef.current = { open: openFind, close: closeFind, step: stepFind, useSel: setFindFromSelection }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (findOpenRef.current) {
          e.preventDefault()
          e.stopPropagation() // 先关查找条，不连锁关闭其他浮层
          findActionsRef.current.close()
          return
        }
        // 查找条已关但有活跃匹配（⌘E 设置后的高亮）：Esc 一并清掉；close 后 matches 清空，不会重复拦截
        if (findRef.current.matches.length > 0) {
          e.preventDefault()
          findActionsRef.current.close()
        }
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'f') {
        e.preventDefault()
        findActionsRef.current.open()
      } else if (k === 'e') {
        e.preventDefault()
        findActionsRef.current.useSel()
      } else if (k === 'g') {
        e.preventDefault()
        // 查找条开（⌘F 场景）或已有词/高亮（⌘E 场景）时都允许步进——对齐 HIG ⌘E→⌘G 工作流
        if (findOpenRef.current || findRef.current.matches.length > 0) findActionsRef.current.step(e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

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
          // 查找条打开且有关键词时：正文被编辑 → 重算匹配并刷新高亮（不跳转，不打扰光标）
          if (findOpenRef.current && findQueryRef.current.trim()) recalcRef.current?.(findQueryRef.current, false)
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
      if (win.__ZJ_TEST) {
        // 无头冒烟接口：真实驱动查找条（open/next/prev/close/goTo + 状态读取）。单编辑器实例窗口下挂载（当前文档页仅一个 Prose）。
        win.__ZJ_FIND = {
          open: (q?: string) => {
            if (q !== undefined) {
              setFindOpen(true)
              setFindQuery(q)
              recalcFind(q, true)
            } else {
              openFind()
            }
          },
          close: closeFind,
          next: () => stepFind(1),
          prev: () => stepFind(-1),
          goTo,
          getState: () => {
            const view = edRef.current
              ? (() => {
                  let v: any = null
                  edRef.current?.action((ctx: any) => {
                    v = ctx.get(editorViewCtx)
                  })
                  return v
                })()
              : null
            const sel = view ? view.state.selection : null
            return {
              open: findOpenRef.current,
              query: findQueryRef.current,
              total: findRef.current.matches.length,
              current: findRef.current.current,
              matches: findRef.current.matches.slice(0, 3),
              selFrom: sel ? sel.from : null,
              selTo: sel ? sel.to : null
            }
          }
        }
      }
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
    <>
      <div className={cn('zj-md flex h-full min-h-0 flex-col overflow-hidden', className)}>
        <EditorToolbar edRef={edRef} />
        <FindBar
          open={findOpen}
          query={findQuery}
          total={findCount.total}
          current={findCount.current}
          onQueryChange={(q) => {
            setFindQuery(q)
            recalcFind(q, true)
          }}
          onNext={() => stepFind(1)}
          onPrev={() => stepFind(-1)}
          onClose={closeFind}
        />
        <ContextMenu onOpenChange={onMenuOpenChange}>
          <ContextMenuTrigger asChild>
            <div ref={hostRef} className="min-h-0 flex-1 overflow-y-auto" onContextMenuCapture={snapMenuSel} />
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-[9.5rem]">
            {menuSel && (
              <>
                <ContextMenuItem onSelect={() => void doCut()}>
                  <Scissors className="mr-0.5 h-3.5 w-3.5" />
                  剪切
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void doCopy()}>
                  <Copy className="mr-0.5 h-3.5 w-3.5" />
                  复制
                </ContextMenuItem>
              </>
            )}
            <ContextMenuItem onSelect={() => void doPaste()}>
              <ClipboardPaste className="mr-0.5 h-3.5 w-3.5" />
              粘贴
            </ContextMenuItem>
            <ContextMenuItem onSelect={doSelectAll}>
              <TextSelect className="mr-0.5 h-3.5 w-3.5" />
              全选
            </ContextMenuItem>
            {menuSel && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={doQuote}>
                  <MessageSquarePlus className="mr-0.5 h-3.5 w-3.5" />
                  添加到对话
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </div>
      {bubble && (
        <div
          className="zj-sel-bubble flex items-center gap-1"
          style={{
            left: bubble.x,
            top: bubble.below ? bubble.y + 10 : bubble.y,
            transform: bubble.below ? 'translate(-50%, 4px)' : 'translate(-50%, calc(-100% - 10px))'
          }}
        >
          <button onClick={copyBubble} title="复制选中文字" aria-label="复制选中文字">
            <Copy className="h-3.5 w-3.5" />
            复制
          </button>
          <button onClick={dispatchQuote} title="把选中文字作为引用添加到右下对话" aria-label="添加到对话">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            添加到对话
          </button>
        </div>
      )}
    </>
  )
}

export type { ProseProps }
