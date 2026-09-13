import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, parserCtx, serializerCtx, prosePluginsCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { selectAll } from 'prosemirror-commands'
import { Plugin, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import '@milkdown/theme-nord/style.css'
import '../../styles/milkdown.css'
import { ClipboardPaste, Copy, MessageSquarePlus, MessageSquareText, Scissors, TextSelect, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import EditorToolbar from './EditorToolbar'
import FindBar from './FindBar'
import { findInDoc, type FindPos } from './finder'
import type { AnnotationRow } from '../../../../shared/annotations'
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
  /** 跳到第 idx 条（默认 0=第一条）可定位的批注（选中并滚动到它）；找不到不动作。
   * row 提供时按 csv 行号精确跳（导航列表用；该行未命中则不动）。 */
  jumpToAnnotation(idx?: number, row?: number): void
  /** 批注抽屉条目 hover 联动：高亮对应侧标（row=csv 行号；传 null 清除） */
  setAnnoActive(row: number | null): void
  destroy(): void
}

interface ProseProps {
  /** 初始内容（仅首挂载生效；换文件用 key 重建） */
  value: string
  onEdit?: (md: string) => void
  apiRef?: MutableRefObject<ProseApi | null>
  className?: string
  /** 本章批注（显示 UI：定位后的 loc/note/before；before 为可在正文匹配的文段，空则跳过） */
  annotations?: AnnotationRow[]
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

/** 批注侧标：同一段落的多条批注合并为一个（rows=csv 行号升序；top=相对 .zj-md 根的 y 坐标） */
interface GutterMark {
  rows: number[]
  note: string
  count: number
  top: number
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

export default function Prose({ value, onEdit, apiRef, className, annotations }: ProseProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const initialRef = useRef<string>(value)
  const onEditRef = useRef(onEdit)
  onEditRef.current = onEdit
  const liveRef = useRef(true)
  const edRef = useRef<any>(null) // Milkdown Editor 实例（工具栏用）

  /* —— 批注显示（F-20260912-04 后半）：被批注片段高亮（PM inline Decoration，class=zj-anno，title=批注意图）。
   * 用 ProseMirror 装饰而非 CSS Custom Highlight：能承载 hover 提示（title）与点击跳转，且与查找高亮
   * （CSS.highlights 原生 Range 层）和选区天然共存。定位口径：before 在 doc 内的文本匹配（findInDoc，
   * 与⌘F 同纯逻辑），匹配不到的行跳过（计数由调用方按 csv 行数展示）。 */
  const annoRef = useRef<AnnotationRow[]>([])
  annoRef.current = annotations ?? []
  const annoPlugin = useMemo(
    () =>
      new Plugin({
        props: {
          decorations(state) {
            const list = annoRef.current
            if (!list.length) return null
            const decos: Decoration[] = []
            for (const a of list) {
              if (!a.before) continue
              const hit = findInDoc(state.doc, a.before)[0]
              if (hit)
                decos.push(
                  Decoration.inline(hit.from, hit.to, {
                    class: 'zj-anno',
                    title: a.note,
                    'data-anno-row': String(a.row ?? 0)
                  })
                )
            }
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          }
        }
      }),
    []
  )
  // 批注变化（加载/划词新增/外部 csv 写入）→ 记到 ref 并触发一次空事务让 view 重算装饰。
  // 编辑器未建时 no-op：建好后 decorations 函数读到的是最新 ref，无需补刷。
  useEffect(() => {
    annoRef.current = annotations ?? []
    scheduleGutterRef.current?.()
    edRef.current?.action((ctx: any) => {
      try {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta('zj-anno-refresh', true))
      } catch {
        /* 视图未就绪时忽略 */
      }
    })
  }, [annotations])

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
  // 划词「批注」（主人 2026-09-12）：带选中原文（before）与尽力而为的行列 loc → Novel 弹层填写意图
  const dispatchAnno = () => {
    if (!bubble) return
    // loc 留空：编辑器只见剥了 front matter 的正文（DocEditor splitFm），这里算出的行号
    // 是「正文内行号」而非 md 文件行号，写入 csv 会误导外部审计——定位以 before 原文兜底
    // （findAnnotationTargets 优先级：csv 第 3 列原文 > loc 行列区间），loc 不作为依赖。
    const loc = ''
    window.dispatchEvent(new CustomEvent('zj:anno-compose', { detail: { loc, before: bubble.text } }))
    setBubble(null)
  }

  /* —— 批注气泡（2026-09-13 体验层：点击高亮弹出意图卡片，替代纯 title 提示；含加入对话/删除该批注）——
   * 位置锚定高亮首行矩形，上方/下方自适应；点击别处/Esc/滚动即关（HIG Popovers：小量信息、箭头指向触发元素、点外关闭）。 */
  const [annoPop, setAnnoPop] = useState<{ row: number; x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    if (!annoPop) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.zj-anno-pop') || t?.closest?.('.zj-anno')) return
      setAnnoPop(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnnoPop(null)
    }
    const onScroll = () => setAnnoPop(null)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey) // 非捕获：查找条 Esc（捕获+stop）优先
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [annoPop])
  const onHostClickAnno = (e: ReactMouseEvent) => {
    const el = (e.target as Element | null)?.closest?.('.zj-anno')
    if (!el) return
    const row = Number((el as HTMLElement).getAttribute('data-anno-row'))
    if (!Number.isFinite(row) || row < 1) return
    const rects = (el as HTMLElement).getClientRects()
    const r = rects.length ? rects[0] : (el as HTMLElement).getBoundingClientRect()
    const below = r.top < 140
    setAnnoPop((cur) => (cur && cur.row === row ? null : { row, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below }))
  }
  const annoPopRow = annoPop ? (annoRef.current.find((a) => a.row === annoPop.row) ?? null) : null

  /* —— 批注侧标（2026-09-13 体验层：候选1② 收口）——
   * 形态：正文左缘（.ProseMirror 的 1.4rem padding 区内）画琥珀圆点，标出被批注段落；
   * 同一段落多条批注合并为一个侧标（title 显示条数）；点击=跳转该段第一条批注（与抽屉/气泡同口径）。
   * 不占正文宽（主人拍板正文满宽）：absolute 悬浮在 .zj-md 根（relative）内，
   * top=PM coordsAtPos 视口坐标 − 根 rect top；内容编辑/批注变化/host 滚动/尺寸变化时 rAF 节流重算；
   * 与抽屉 hover 联动（setAnnoActive）。不用 fixed：页面路由动画的 transform 祖先会劫持 fixed 的 containing block。 */
  const [gutter, setGutter] = useState<GutterMark[]>([])
  const [gutterActive, setGutterActive] = useState<number | null>(null)
  const gutterPendingRef = useRef(false)
  const computeGutter = () => {
    const root = hostRef.current?.parentElement
    let view: any = null
    try {
      edRef.current?.action((ctx: any) => {
        view = ctx.get(editorViewCtx)
      })
    } catch {
      return
    }
    if (!root || !view) return
    const list = annoRef.current
    if (!list.length) {
      setGutter([])
      return
    }
    const rootRect = root.getBoundingClientRect()
    // 同段合并：以 PM 块级父节点为分组（resolve(hit.from).parent），段内多条只画一个侧标
    const groups = new Map<object, { rows: number[]; note: string; count: number; top: number }>()
    for (const a of list) {
      if (!a.before) continue
      const hit = findInDoc(view.state.doc, a.before)[0]
      if (!hit) continue
      let top = 0
      try {
        top = view.coordsAtPos(hit.from).top - rootRect.top
      } catch {
        continue
      }
      const parent = view.state.doc.resolve(hit.from).parent
      const g = groups.get(parent)
      if (g) {
        g.rows.push(a.row ?? 0)
        g.count++
      } else {
        groups.set(parent, { rows: [a.row ?? 0], note: a.note || '批注', count: 1, top })
      }
    }
    const marks = [...groups.values()]
      .map((g) => ({ rows: g.rows.sort((x, y) => x - y), note: g.note, count: g.count, top: g.top }))
      .sort((x, y) => x.top - y.top)
    setGutter(marks)
  }
  const scheduleGutter = () => {
    if (gutterPendingRef.current) return
    gutterPendingRef.current = true
    requestAnimationFrame(() => {
      gutterPendingRef.current = false
      computeGutter()
    })
  }
  const scheduleGutterRef = useRef(scheduleGutter)
  scheduleGutterRef.current = scheduleGutter
  // host 滚动 / 根尺寸（窗口缩放、agent 面板拖拽）→ 重算侧标位置
  useEffect(() => {
    const host = hostRef.current
    const root = host?.parentElement
    if (!host || !root) return
    const onScroll = () => scheduleGutterRef.current?.()
    host.addEventListener('scroll', onScroll)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduleGutterRef.current?.()) : null
    ro?.observe(root)
    return () => {
      host.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  }, [])
  const gotoGutterRow = (row: number) => {
    try {
      edRef.current?.action((ctx: any) => {
        const view = ctx.get(editorViewCtx)
        const a = annoRef.current.find((x) => x.row === row)
        if (!a || !a.before) return
        const hits = findInDoc(view.state.doc, a.before)
        if (!hits.length) return
        const f = hits[0]
        const tr = view.state.tr
        tr.setSelection(TextSelection.create(view.state.doc, f.from, f.to))
        tr.scrollIntoView()
        view.dispatch(tr)
        view.focus()
      })
    } catch {
      /* 编辑器未就绪时忽略 */
    }
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
        // 焦点在抽屉/弹层（role=dialog）内时不拦截：Esc 让当前层处理（useModalA11y 关抽屉），
        // 否则会先抢关查找条并 stopPropagation、抽屉永远关不掉（HIG：Esc 关闭当前聚焦层）。
        const inDialog = !!(document.activeElement && document.activeElement.closest('[role="dialog"]'))
        if (inDialog) return
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
        ctx.set(prosePluginsCtx, [annoPlugin])
        ctx.get(listenerCtx).markdownUpdated((_, md) => {
          if (!liveRef.current) return
          onEditRef.current?.(md)
          // 查找条打开且有关键词时：正文被编辑 → 重算匹配并刷新高亮（不跳转，不打扰光标）
          if (findOpenRef.current && findQueryRef.current.trim()) recalcRef.current?.(findQueryRef.current, false)
          // 正文被编辑 → 侧标位置重算（锚定文本行）
          scheduleGutterRef.current?.()
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
        setAnnoActive: (row) =>
          setGutterActive(typeof row === 'number' && Number.isFinite(row) && row >= 1 ? row : null),
        jumpToAnnotation: (idx = 0, row?: number) =>
          e.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            // row 优先：按 csv 行号精确定位（批注导航列表用；无 before 或 findInDoc 未命中则不动）
            if (row !== undefined) {
              const a = annoRef.current.find((x) => x.row === row)
              if (!a || !a.before) return
              const hits = findInDoc(view.state.doc, a.before)
              if (!hits.length) return
              const f = hits[0]
              const tr = view.state.tr
              tr.setSelection(TextSelection.create(view.state.doc, f.from, f.to))
              tr.scrollIntoView()
              view.dispatch(tr)
              view.focus()
              return
            }
            let seen = -1
            for (const a of annoRef.current) {
              if (!a.before) continue
              const hits = findInDoc(view.state.doc, a.before)
              if (!hits.length) continue
              seen++
              if (seen === idx) {
                const f = hits[0]
                const tr = view.state.tr
                tr.setSelection(TextSelection.create(view.state.doc, f.from, f.to))
                tr.scrollIntoView()
                view.dispatch(tr)
                view.focus()
                return
              }
            }
          }),
        destroy: () => e.destroy()
      }
      if (apiRef) apiRef.current = api
      testRegister(api)
      // 编辑器就绪：初次计算批注侧标位置
      scheduleGutterRef.current?.()
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
      <div className={cn('zj-md relative flex h-full min-h-0 flex-col overflow-hidden', className)}>
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
            <div ref={hostRef} className="min-h-0 flex-1 overflow-y-auto" onClick={onHostClickAnno} onContextMenuCapture={snapMenuSel} />
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
        {gutter.length > 0 && (
          <div className="zj-anno-gutter" aria-hidden="true">
            {gutter.map((g) => (
              <button
                key={`g${g.rows[0]}`}
                type="button"
                className={cn('zj-anno-mark', g.rows.includes(gutterActive ?? -1) && 'zj-anno-mark-active')}
                style={{ top: g.top }}
                title={g.count > 1 ? `同段共 ${g.count} 条批注：${g.note}` : g.note}
                aria-label={`定位第 ${g.rows[0]} 行批注`}
                data-rows={g.rows.join(',')}
                onClick={() => gotoGutterRow(g.rows[0])}
              />
            ))}
          </div>
        )}
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
            对话
          </button>
          <button onClick={dispatchAnno} title="给选中文字添加批注（供批注优化生成修改提案）" aria-label="添加批注">
            <MessageSquareText className="h-3.5 w-3.5" />
            批注
          </button>
        </div>
      )}
      {annoPop && annoPopRow && (
        <div
          className="zj-anno-pop"
          role="tooltip"
          style={{
            left: annoPop.x,
            top: annoPop.below ? annoPop.y + 10 : annoPop.y,
            transform: annoPop.below ? 'translate(-50%, 4px)' : 'translate(-50%, calc(-100% - 10px))'
          }}
        >
          <div className="zj-anno-pop-note">{annoPopRow.note}</div>
          <div className="zj-anno-pop-meta">
            {annoPopRow.loc ? `L${annoPopRow.loc}` : `批注 #${annoPopRow.row ?? '?'}`}
            {annoPopRow.before ? ` · 「${annoPopRow.before.length > 32 ? annoPopRow.before.slice(0, 32) + '…' : annoPopRow.before}」` : ''}
          </div>
          <div className="zj-anno-pop-actions">
            <button
              onClick={() => {
                if (annoPopRow.before) window.dispatchEvent(new CustomEvent('zj:quote-text', { detail: annoPopRow.before }))
                setAnnoPop(null)
              }}
              title="把批注原文作为引用添加到右下对话"
              aria-label="加入对话"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              加入对话
            </button>
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('zj:anno-remove', { detail: { row: annoPop.row } }))
                setAnnoPop(null)
              }}
              className="zj-anno-pop-remove"
              title="删除这条批注（从 .csv 移除，空文件删除）"
              aria-label="删除该批注"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除该批注
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export type { ProseProps }
