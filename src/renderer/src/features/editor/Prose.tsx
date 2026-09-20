import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'
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
import { useAppStore } from '../../store/app'
import { FOCUS_DIM_CLASS, FOCUS_ON_CLASS, focusBlockRange } from './focusMode'
import { makeTypewriterPlugin } from './typewriter'
import EditorToolbar from './EditorToolbar'
import FindBar from './FindBar'
import { findInDoc, type FindPos } from './finder'
import { saveScroll, takeScroll } from './scrollMemory'
import { anchorFromPos, restoreCursorSelection, saveCursor, takeCursor } from './cursorMemory'
import { EMPTY_ACTIVE, activeEq, readToolbarActive, type ActiveState } from './toolbarActive'
import { macTextKeysPlugin } from './macTextKeys'
import {
  computeFloatingPos,
  FLOAT_EST_ANNO_POP,
  FLOAT_EST_BUBBLE,
  type FloatSize
} from './floatingPos'
import type { AnnotationRow } from '../../../../shared/annotations'
import { MENU_EV_FIND, isMenuJustHandled } from '../menu/menuBus'
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
  /** 测试/脚本用：把光标定位到 doc 文本中第一个 needle 起始处（无匹配不动） */
  setCursor(needle: string): void
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
  /** 编辑器初始化（Milkdown create）失败回调——默认入口把失败静默成空白编辑器
   * （P1 F-20260917-10 走查：create 拒绝属未处理拒绝，宿主空白且无任何提示）。
   * 父级据此显式呈现错误卡（与「读取失败显式化」同口径）。 */
  onCreateError?: (msg: string) => void
  className?: string
  /** 本章批注（显示 UI：定位后的 loc/note/before；before 为可在正文匹配的文段，空则跳过） */
  annotations?: AnnotationRow[]
  /** 批注入口（划词浮层「批注」钮 + 右键「写入批注」）是否可用——批注管道只作用 `正文/**`，非正文语境传 false 隐藏（HIG：隐藏不可用项）。默认 true（正文场景）。 */
  anno?: boolean
  /** 滚动位置记忆键（`项目id:相对路径`）。提供时在卸载/重建时保存 scrollTop，
   * 重新挂载后恢复（会话内、不落盘）；缺省不启用。 */
  memoryKey?: string
}

interface WinWithEditors {
  __ZJ_TEST?: boolean
  __ZJ_EDITORS?: ProseApi[]
  __ZJ_SEL?: {
    /** 无头冒烟接口：读当前 PM selection（from/to/empty） */
    get: () => { from: number; to: number; empty: boolean } | null
  }
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

export default function Prose({ value, onEdit, apiRef, onCreateError, className, annotations, anno = true, memoryKey }: ProseProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const initialRef = useRef<string>(value)
  const onEditRef = useRef(onEdit)
  onEditRef.current = onEdit
  const onCreateErrorRef = useRef(onCreateError)
  onCreateErrorRef.current = onCreateError
  const liveRef = useRef(true)
  /** create 代次计数器：StrictMode/重挂载后旧 Editor.make().create() 的异步结果必须销毁，
   * 否则新旧两个 editor 会同时挂在同一宿主 DOM 上（「编辑区双占位/双正文」根因，F-20260917-11）。
   * 为什么不用 liveRef 判断：React 18 StrictMode 的 mount→cleanup→mount 是同一实例，
   * cleanup 把 liveRef 置 false 后第二次 effect 又置回 true，旧 create 的回调误判自身仍有效。 */
  const createEpochRef = useRef(0)
  const edRef = useRef<any>(null) // Milkdown Editor 实例（工具栏用）
  /** 滚动位置记忆键：挂载时快照（不随 prop 更新）——切章时同一 Prose 实例会先被 render 注入新 rel 的
   * memoryKey 再卸载，若随 prop 更新会把位置存到错误 key（2026-09-16 实锤：1200 存进「灯塔」、雾港得 0） */
  const memoryKeyRef = useRef<string | undefined>(memoryKey)
  /** 文档变更信号：markdownUpdated 时递增，EditorToolbar 据此重读撤销/重做可用态（HIG：不可用置灰示态） */
  const [histTick, setHistTick] = useState(0)
  /** 光标处格式激活快照（selection 级：加粗/标题/列表等 toggle 工具的 toggled 态；
   * 由 selPlugin（PM Plugin view.update，每次 dispatch 都会走）读取并与上次比较，变化才 setState——
   * 打字/光标移动不改变格式时零重渲染（23:55 轮「避免每次光标移动都重渲染」的刻意设计延续）。 */
  const [active, setActive] = useState<ActiveState | null>(null)
  const activeRef = useRef<ActiveState | null>(null)
  const onSelRef = useRef<(view: any) => void>(() => {})
  onSelRef.current = (view: any) => {
    const next = readToolbarActive(view.state)
    if (activeRef.current && activeEq(next, activeRef.current)) return
    activeRef.current = next
    setActive(next === EMPTY_ACTIVE ? null : next)
  }

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
        /* 编辑器未就绪时忽略 */
      }
    })
  }, [annotations])

  /** 选区级激活态跟踪：PM Plugin view.update 在每次 dispatch（含光标移动/选区的选择事务）后回调；
   * 与 annoPlugin 的 decorations 不同，本插件无状态、只为把「当前格式快照」差量同步给 React（onSelRef）。
   * 为什么不用 DOM selectionchange：PM 内部 dispatch 的事务（含键盘移动它自己生成的 selection 事务）
   * 不必然映射为 DOM selectionchange 事件，且处理顺序不可控——plugin 层是 PM 的官方语义。 */
  const selPlugin = useMemo(
    () =>
      new Plugin({
        view: () => ({
          update: (view: any) => {
            onSelRef.current(view)
          }
        })
      }),
    []
  )

  /* —— 正文字档空占位（HIG Text Fields「placeholder 描述预期输入」；2026-09-16 体验层）——
   * 正文全空（仅空段）时给编辑器根挂 .zj-empty，milkdown.css 用 ::before 显示「开始写作…」；
   * 出现任何文字即摘除（与 input placeholder 习惯一致：聚焦仍在、输入首字符后消失）。
   * ProseMirror 无内建 empty 态，用 PluginView.update 逐 dispatch 判 textBetween 即可；
   * 零依赖（不引 @milkdown/plugin-placeholder），与 annoPlugin/selPlugin 同走 prosePluginsCtx。 */
  const emptyHintPlugin = useMemo(
    () =>
      new Plugin({
        view: (v) => {
          const apply = () =>
            v.dom.classList.toggle('zj-empty', v.state.doc.textBetween(0, v.state.doc.content.size, '\n') === '')
          apply()
          return { update: apply, destroy: () => {} }
        }
      }),
    []
  )

  /* —— 焦点模式（体验层 2026-09-17；iA Writer / Typora Focus Mode 同范式，质感主线候选）——
   * 设置「焦点模式」开启时：当前顶层块（当前段/列表等）保持，其余顶层块加 .zj-focus-dim 淡化；
   * 选区跨顶层块 → 不淡化（整体选择时不干扰）；默认关（设置页开关）。实现=PM 无状态 decoration，
   * 零依赖；开关变化经 useEffect 发 meta 触发重算（与 annoPlugin 同法）；过渡与 reduced-motion 见 milkdown.css。 */
  const focusOn = useAppStore((s) => s.settings?.focusModeEnabled ?? false)
  const focusOnRef = useRef(focusOn)
  focusOnRef.current = focusOn
  const focusPlugin = useMemo(
    () =>
      new Plugin({
        view: (v) => {
          let lastOn: boolean | null = null
          const apply = () => {
            const next = focusOnRef.current
            if (lastOn === next) return
            lastOn = next
            v.dom.classList.toggle(FOCUS_ON_CLASS, next)
          }
          apply()
          return {
            update: apply,
            destroy: () => v.dom.classList.remove(FOCUS_ON_CLASS)
          }
        },
        props: {
          decorations(state) {
            if (!focusOnRef.current) return null
            const r = focusBlockRange(state)
            if (!r) return null
            const decos: Decoration[] = []
            let pos = 0
            for (let i = 0; i < state.doc.childCount; i++) {
              const n = state.doc.child(i)
              const from = pos
              pos += n.nodeSize
              if (from === r.from && pos === r.to) continue
              decos.push(Decoration.node(from, pos, { class: FOCUS_DIM_CLASS }))
            }
            return DecorationSet.create(state.doc, decos)
          }
        }
      }),
    []
  )
  // 开关变化：编辑器中点一次空事务让 decorations 重算（未挂编辑器时 no-op，挂载时插件读最新 ref）
  useEffect(() => {
    edRef.current?.action((ctx: any) => {
      try {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta('zj-focus-refresh', true))
      } catch {
        /* 编辑器未就绪时忽略 */
      }
    })
  }, [focusOn])

  /* —— 打字机滚动（体验层 2026-09-17；Typora Typewriter Mode「仅输入时固定」同范式）——
   * 设置「打字机滚动」开启且用户键入（doc 变化 + 编辑器聚焦）时，把光标行滚回滚动容器
   * 垂直中线；鼠标点击/方向键移动选区（doc 不变）与程序化 setContent/applyMarkdown
   * （programmatic 标记）不触发，滚动记忆/光标恢复不受影响；默认关（设置页开关）。
   * 实现=无状态 PM 插件（零依赖，同 focusPlugin/emptyHintPlugin 走 prosePluginsCtx）。 */
  const twOn = useAppStore((s) => s.settings?.typewriterEnabled ?? false)
  const twOnRef = useRef(twOn)
  twOnRef.current = twOn
  /** 程序化注入标记：setContent/applyMarkdown 期间为 true（rAF 后复位），
   * 让 typewriter 跳过，保住切章滚动记忆/静默重载光标恢复（2026-09-17 先验约束）。 */
  const programmaticRef = useRef(false)
  const markProgrammatic = () => {
    programmaticRef.current = true
    requestAnimationFrame(() => {
      programmaticRef.current = false
    })
  }
  const typewriterPlugin = useMemo(
    () =>
      makeTypewriterPlugin({
        isEnabled: () => twOnRef.current,
        getHost: () => hostRef.current,
        isProgrammatic: () => programmaticRef.current
      }),
    []
  )

  /* —— 划词浮层：选中文本 → 送进对话引用（全局事件 zj:quote-text）——
   * 位置口径（2026-09-15 体验层：贴边翻转）：state 存锚点视口矩形（cx/top/bottom）与初始方位意图；
   * 渲染与测量 effect 共同经 computeFloatingPos（floatingPos.ts 纯函数，可单测）得出最终坐标——
   * 垂直按「上方放不下→翻下方→双侧不足取大侧并钳制」，水平中心越界钳回视口（HIG Popovers 定位）。 */
  const [bubble, setBubble] = useState<{ text: string; cx: number; top: number; bottom: number; below: boolean } | null>(null)
  const bubbleRef = useRef(bubble)
  bubbleRef.current = bubble
  const bubbleElRef = useRef<HTMLDivElement | null>(null)
  const [bubbleSize, setBubbleSize] = useState<FloatSize | null>(null)
  /** 程序化定位（批注跳转）后的划词浮层抑制窗口：PM 同步 DOM 选区会触发 selectionchange，
   * 不能把「定位选中」当成「用户划词」弹浮层（HIG Popovers：一次只显示一个浮层；定位动作不弹编辑菜单）。
   * 跳转动作设锁并清浮层，onSel 见锁内则保持关闭；用户手动划词超窗即恢复（600ms 足够宽）。 */
  const progSelLockRef = useRef(0)
  // 挂载后实测浮层尺寸并回写 state（useLayoutEffect：paint 前完成，首帧估计位不闪烁）
  useLayoutEffect(() => {
    if (!bubble) {
      setBubbleSize(null)
      return
    }
    const el = bubbleElRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setBubbleSize((cur) => (cur && cur.w === r.width && cur.h === r.height ? cur : { w: r.width, h: r.height }))
  }, [bubble])
  /** 焦点回编辑器（浮层/气泡动作或 Esc 关闭后；HIG：焦点不丢、人知道在哪） */
  const focusEditor = () => {
    try {
      edRef.current?.action((ctx: any) => ctx.get(editorViewCtx).focus())
    } catch {
      /* 编辑器未就绪时忽略 */
    }
  }
  useEffect(() => {
    const onSel = () => {
      const host = hostRef.current
      const s = window.getSelection()
      // 程序化定位（批注跳转）后 600ms 内：PM 同步 DOM 选区引起的 selectionchange 不弹划词浮层
      if (progSelLockRef.current && performance.now() - progSelLockRef.current < 600) {
        setBubble(null)
        return
      }
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
      // below 仅作首帧意图（贴近顶部）；权威方位由 computeFloatingPos 按实测尺寸与视口空间判定
      const below = rect.top < 120
      // 用户主动划词 → 收起批注气泡（HIG Popovers：同一时点只保留一个浮层；键盘划词不经过 mousedown，
      // 气泡的“点外关闭”监听不到，须在此收口——2026-09-20 联动走查实锤：气泡开着时 Shift+↓ 双浮层同屏）
      setAnnoPop(null)
      setBubble({ text: t, cx: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, below })
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
    focusEditor()
  }
  // 批注发起（2026-09-15 体验层：浮层/右键双入口单源化）——loc 留空：编辑器只见剥了 front matter 的正文
  // （DocEditor splitFm），这里算出的行号是「正文内行号」而非 md 文件行号，写入 csv 会误导外部审计——
  // 定位以 before 原文兜底（findAnnotationTargets 优先级：csv 第 3 列原文 > loc 行列区间），loc 不作为依赖。
  const annCompose = (text: string) => {
    const loc = ''
    window.dispatchEvent(new CustomEvent('zj:anno-compose', { detail: { loc, before: text } }))
  }
  // 划词浮层「批注」（主人 2026-09-12）：带选中原文 → Novel 弹层填写意图
  const dispatchAnno = () => {
    if (!bubble) return
    annCompose(bubble.text)
    setBubble(null)
  }

  /* —— 批注气泡（2026-09-13 体验层：点击高亮弹出意图卡片，替代纯 title 提示；含加入对话/删除该批注）——
   * 位置锚定高亮首行矩形，上方/下方自适应；点击别处/Esc/滚动即关（HIG Popovers：小量信息、箭头指向触发元素、点外关闭）。 */
  const [annoPop, setAnnoPop] = useState<{ row: number; cx: number; top: number; bottom: number; below: boolean } | null>(null)
  const annoPopRef = useRef(annoPop)
  annoPopRef.current = annoPop
  const annoPopElRef = useRef<HTMLDivElement | null>(null)
  const [annoPopSize, setAnnoPopSize] = useState<FloatSize | null>(null)
  useLayoutEffect(() => {
    if (!annoPop) {
      setAnnoPopSize(null)
      return
    }
    const el = annoPopElRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAnnoPopSize((cur) => (cur && cur.w === r.width && cur.h === r.height ? cur : { w: r.width, h: r.height }))
  }, [annoPop])
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
    window.addEventListener('keydown', onKey) // 非捕获：查找条 Esc（捕获+stop）优先；焦点在气泡内时由全局分支处理
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [annoPop])
  // Tab 圈闭：焦点进入气泡后 Tab/⇧Shift-Tab 在两按钮间循环，不逃逸到页面后续元素（HIG Popovers 键盘交互；Esc/点外/动作关闭）
  useEffect(() => {
    if (!annoPop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const el = document.activeElement as HTMLElement | null
      if (!el || !el.closest('.zj-anno-pop')) return
      const pop = document.querySelector('.zj-anno-pop')
      const btns = [...(pop?.querySelectorAll('button') ?? [])] as HTMLElement[]
      if (!btns.length) return
      e.preventDefault()
      const i = btns.indexOf(el)
      const next = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : (i >= btns.length - 1 ? 0 : i + 1)
      ;(btns[next] as HTMLElement).focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [annoPop])
  const onHostClickAnno = (e: ReactMouseEvent) => {
    const el = (e.target as Element | null)?.closest?.('.zj-anno')
    if (!el) return
    const row = Number((el as HTMLElement).getAttribute('data-anno-row'))
    if (!Number.isFinite(row) || row < 1) return
    const rects = (el as HTMLElement).getClientRects()
    const r = rects.length ? rects[0] : (el as HTMLElement).getBoundingClientRect()
    // below 仅作首帧意图；权威方位按实测尺寸与视口空间判定（floatingPos，贴边翻转）
    const below = r.top < 140
    setAnnoPop((cur) => (cur && cur.row === row ? null : { row, cx: r.left + r.width / 2, top: r.top, bottom: r.bottom, below }))
  }
  const annoPopRow = annoPop ? (annoRef.current.find((a) => a.row === annoPop.row) ?? null) : null
  /** 最终布局（floatingPos 纯函数）：尺寸未测得时用估计值（挂载后 useLayoutEffect 立即实测修正，paint 前完成） */
  const bubblePos = bubble
    ? computeFloatingPos({ cx: bubble.cx, top: bubble.top, bottom: bubble.bottom }, bubbleSize ?? FLOAT_EST_BUBBLE, window.innerWidth, window.innerHeight)
    : null
  const annoPopPos = annoPop
    ? computeFloatingPos({ cx: annoPop.cx, top: annoPop.top, bottom: annoPop.bottom }, annoPopSize ?? FLOAT_EST_ANNO_POP, window.innerWidth, window.innerHeight)
    : null

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
  // 顺带把最新 scrollTop 记入 ref：卸载时 DOM 已 detach（scrollTop 读回 0），
  // 滚动记忆必须用最后已知值（2026-09-16 冒烟实锤：cleanup 里直接读 host.scrollTop 得 0）。
  const lastScrollRef = useRef(0)
  useEffect(() => {
    const host = hostRef.current
    const root = host?.parentElement
    if (!host || !root) return
    const onScroll = () => {
      lastScrollRef.current = host.scrollTop
      // 滚动即保存（记忆键为挂载快照，不受卸载前 props 污染影响）；卸载兜底保存见 create effect cleanup
      const mk = memoryKeyRef.current
      if (mk) saveScroll(mk, host.scrollTop)
      scheduleGutterRef.current?.()
    }
    host.addEventListener('scroll', onScroll)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduleGutterRef.current?.()) : null
    ro?.observe(root)
    return () => {
      host.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  }, [])

  // —— 光标记忆：PM selection 变更即保存（cursorMemory.ts；与滚动记忆同 key）——
  // 只读 PM state 而非 DOM selection：编辑器外点击（切章按钮/Agent 面板）不会清 PM state，
  // 不会把「空选区」误存覆盖掉刚才的正确锚；保存键为挂载快照 memoryKey（与滚动同坑防 props 污染）。
  useEffect(() => {
    if (!memoryKeyRef.current) return
    const onSel = () => {
      const e = edRef.current
      if (!e || !liveRef.current) return
      e.action((ctx: any) => {
        const view = ctx.get(editorViewCtx)
        const sel = view.state.selection
        const a = anchorFromPos(view.state.doc, sel.from, sel.to)
        if (a && memoryKeyRef.current) saveCursor(memoryKeyRef.current, a)
      })
    }
    document.addEventListener('selectionchange', onSel)
    return () => {
      document.removeEventListener('selectionchange', onSel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const gotoGutterRow = (row: number) => {
    // 定位动作≠用户划词：抑制 PM 同步 DOM 选区引发的 selectionchange 弹浮层（2026-09-20 联动走查）
    progSelLockRef.current = performance.now()
    setBubble(null)
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
  // 右键「写入批注」（2026-09-15 体验层）：与划词浮层批注同链路（zj:anno-compose → Novel 弹层），
  // 文本取右键时快照的 menuSel；HIG Context menus「一致性」——主界面（划词浮层）有的写作域动作右键也应有。
  const doAnno = () => {
    if (menuSel) annCompose(menuSel)
  }
  const copyBubble = () => {
    if (!bubble) return
    void doCopy(bubble.text)
    setBubble(null)
    focusEditor()
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
        // 焦点在编辑器浮层（划词浮层/批注气泡）内：Esc 关当前浮层并把焦点还给编辑器
        // （HIG：Esc 关闭当前聚焦层 + 焦点不能丢；此分支先于查找条——浮层是更临时的交互层）。
        const fEl = document.activeElement as HTMLElement | null
        if (fEl?.closest?.('.zj-sel-bubble, .zj-anno-pop')) {
          e.preventDefault()
          e.stopPropagation()
          if (fEl.closest('.zj-anno-pop')) setAnnoPop(null)
          else setBubble(null)
          focusEditor()
          return
        }
        // 焦点在正文工具栏内：Esc 回焦正文编辑器（Tab 进工具栏后的键盘出口；HIG Keyboards＝控件
        // 遍历靠 Tab 循环，Esc 结束当前控件层；不 preventDefault——Radix More 菜单等后续处理器照常）。
        if (fEl?.closest?.('.zj-md-toolbar')) {
          focusEditor()
          return
        }
        // 浮层开着但焦点在编辑器内（键盘选择后）：Esc 取消当前选区工具（无查找会话时），关注点不动
        if ((bubbleRef.current || annoPopRef.current) && !findOpenRef.current && fEl?.closest?.('.ProseMirror')) {
          e.preventDefault()
          e.stopPropagation()
          if (annoPopRef.current) setAnnoPop(null)
          else setBubble(null)
          return
        }
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
        if (isMenuJustHandled('findOpen')) return
        e.preventDefault()
        findActionsRef.current.open()
      } else if (k === 'e') {
        if (isMenuJustHandled('findUseSel')) return
        e.preventDefault()
        findActionsRef.current.useSel()
      } else if (k === 'g') {
        if (isMenuJustHandled(e.shiftKey ? 'findPrev' : 'findNext')) return
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

  // 系统菜单 编辑→查找 组：菜单动作 → 本文查找（菜单 accelerator 与 keydown 可能双达，防双触发同上）
  useEffect(() => {
    const h = (ev: Event) => {
      const kind = (ev as CustomEvent).detail
      if (kind === 'findOpen') findActionsRef.current.open()
      else if (kind === 'findUseSel') findActionsRef.current.useSel()
      else if (kind === 'findNext') findActionsRef.current.step(1)
      else if (kind === 'findPrev') findActionsRef.current.step(-1)
    }
    window.addEventListener(MENU_EV_FIND, h)
    return () => window.removeEventListener(MENU_EV_FIND, h)
  }, [])

  useEffect(() => {
    if (!hostRef.current) return
    let api: ProseApi | null = null
    liveRef.current = true
    const myEpoch = ++createEpochRef.current
    // 冒烟注入：Milkdown create 拒绝在真机不可复现（无稳定触发），按 devShim ?zj-null 先例提供
    // URL 参数注入面（?zj-createfail），供无头脚本端到端验证「初始化失败卡」呈现；生产零影响。
    if (new URLSearchParams(typeof location !== 'undefined' ? location.search : '').has('zj-createfail')) {
      void Promise.reject(new Error('注入：编辑器初始化失败（冒烟）')).catch((err: unknown) => {
        if (createEpochRef.current !== myEpoch || !liveRef.current) return
        onCreateErrorRef.current?.(err instanceof Error ? err.message : String(err))
      })
      return () => {
        liveRef.current = false
        edRef.current = null
      }
    }
    const ed = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, hostRef.current!)
        ctx.set(defaultValueCtx, initialRef.current)
        ctx.set(prosePluginsCtx, [annoPlugin, selPlugin, emptyHintPlugin, focusPlugin, typewriterPlugin, macTextKeysPlugin].filter((p): p is NonNullable<typeof p> => !!p))
        ctx.get(listenerCtx).markdownUpdated((_, md) => {
          if (!liveRef.current) return
          onEditRef.current?.(md)
          // 工具栏撤销/重做可用态随之重读（文档变更才影响 history 深度）
          setHistTick((t) => t + 1)
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
      // 代次不符：本 create 已被更新一次的 effect 取代（StrictMode 双 effect/快速重挂载）——
      // 立即销毁，否则新旧两个 editor 会同时挂在同一宿主 DOM（F-20260917-11 双占位根因）
      if (createEpochRef.current !== myEpoch) {
        void e.destroy()
        return
      }
      edRef.current = e
      if (!liveRef.current) {
        e.destroy()
        return
      }
      // —— 会话内滚动位置恢复（scrollMemory.ts；vscode#329625 同口径：切回文档回到上次位置）——
      // 恢复即消费；内容未变时 scrollHeight 相同可直接恢复，异步布局（字体/图片）完成后二次 clamp（幂等）。
      const mk = memoryKeyRef.current
      if (mk) {
        const saved = takeScroll(mk)
        if (saved !== undefined && saved > 0 && hostRef.current) {
          const host = hostRef.current
          const clamp = () => {
            host.scrollTop = Math.min(saved, Math.max(0, host.scrollHeight - host.clientHeight))
          }
          requestAnimationFrame(clamp)
          window.setTimeout(() => {
            if (hostRef.current === host) {
              host.scrollTop = Math.min(saved, Math.max(0, host.scrollHeight - host.clientHeight))
            }
          }, 600)
        }
      }
      // —— 会话内光标/选区恢复（cursorMemory.ts；Pages/TextEdit 惯例「回到上次写/读处」）——
      // 恢复即消费；文本已改→容错降级（见 restoreCursorSelection 注释），找不到不动不打扰。
      // 重建路径 focus 编辑器：作者点章即编辑的意图（与滚动恢复次序无关，文本锚不依赖布局）。
      if (mk) {
        const saved = takeCursor(mk)
        if (saved) {
          e.action((ctx: any) => {
            const view = ctx.get(editorViewCtx)
            const pos = restoreCursorSelection(view.state.doc, saved)
            if (pos) {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.from, pos.to)))
              view.focus()
            }
          })
        }
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
        applyMarkdown: (md, replaceSel) => {
          markProgrammatic()
          e.action((ctx: any) => {
            const view = ctx.get(editorViewCtx)
            const parser = ctx.get(parserCtx)
            const doc = parser(md)
            const { from, to, empty } = view.state.selection
            let tr = view.state.tr
            if (replaceSel && !empty) tr = tr.replaceWith(from, to, doc)
            else tr = tr.insert(from, doc)
            view.dispatch(tr)
            view.focus()
          })
        },
        setContent: (md) => {
          // 程序化注入：typewriter 跳过本次，保住滚动记忆/光标恢复（2026-09-17）
          markProgrammatic()
          e.action((ctx: any) => {
            const view = ctx.get(editorViewCtx)
            const parser = ctx.get(parserCtx)
            const doc = parser(md)
            view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc))
            // 静默重载（外部写入磁盘→extVersion→灌回）：恢复记忆光标，但不抢焦点
            // （用户此刻可能正在 Agent 面板/别处；回到编辑器时自然落在记忆位置）
            const mk = memoryKeyRef.current
            if (mk) {
              const saved = takeCursor(mk)
              if (saved) {
                const pos = restoreCursorSelection(view.state.doc, saved)
                if (pos) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.from, pos.to)))
              }
            }
          })
        },
        setCursor: (needle) =>
          e.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            let pos = -1
            view.state.doc.descendants((node, p) => {
              if (pos >= 0) return false
              if (node.isText && node.text) {
                const i = node.text.indexOf(needle)
                if (i >= 0) pos = p + i
              }
              return true
            })
            if (pos < 0) return
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
            view.focus()
          }),
        focus: () => e.action((ctx) => ctx.get(editorViewCtx).focus()),
        setAnnoActive: (row) =>
          setGutterActive(typeof row === 'number' && Number.isFinite(row) && row >= 1 ? row : null),
        jumpToAnnotation: (idx = 0, row?: number) => {
          // 定位动作≠用户划词：抑制浮层（PM 同步 DOM 选区触发 selectionchange）
          progSelLockRef.current = performance.now()
          setBubble(null)
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
              // 不调 view.focus()：抽屉是模态（role=dialog + 焦点圈闭 + 遮罩），焦点留在抽屉内，
              // 否则键盘输入会绕过遮罩直改正文（2026-09-20 联动走查实锤：模态开着时按 x 正文被删改）。
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
                return
              }
            }
          })
        },
        destroy: () => e.destroy()
      }
      if (apiRef) apiRef.current = api
      testRegister(api)
      // 编辑器就绪：初次计算批注侧标位置
      scheduleGutterRef.current?.()
      if (win.__ZJ_TEST) {
        // 无头冒烟接口：读当前 PM selection（光标记忆冒烟用；单编辑器实例窗口下挂载）
        win.__ZJ_SEL = {
          get: () => {
            let out: { from: number; to: number; empty: boolean } | null = null
            e.action((ctx: any) => {
              const view = ctx.get(editorViewCtx)
              const sel = view.state.selection
              out = { from: sel.from, to: sel.to, empty: sel.empty }
            })
            return out
          }
        }
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
    ed.catch((err: unknown) => {
      // create 拒绝=初始化失败：代次不符（被 StrictMode/重挂载的更新实例取代）或组件已卸载时静默
      // （旧实例生命周期本就结束）；其余必须显式呈现——旧代码无 catch=未处理拒绝，宿主空白、
      // 无任何提示（P1 F-20260917-10 走查：与「读不到静默当空」同型的不见性缺口）。
      if (createEpochRef.current !== myEpoch || !liveRef.current) return
      onCreateErrorRef.current?.(err instanceof Error ? err.message : String(err))
    })
    return () => {
      liveRef.current = false
      // 卸载/重建前兜底保存（滚动监听已实时保存；此处在 DOM detach 前用最后已知值兜底）
      const mk = memoryKeyRef.current
      if (mk) saveScroll(mk, lastScrollRef.current)
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
        <EditorToolbar edRef={edRef} histTick={histTick} active={active} />
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
                {anno && (
                  <ContextMenuItem onSelect={doAnno}>
                    <MessageSquareText className="mr-0.5 h-3.5 w-3.5" />
                    写入批注
                  </ContextMenuItem>
                )}
                <ContextMenuItem onSelect={doQuote}>
                  <MessageSquarePlus className="mr-0.5 h-3.5 w-3.5" />
                  添加到对话
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
        {gutter.length > 0 && (
          <div className="zj-anno-gutter">
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
      {bubble && bubblePos && (
        <div
          ref={bubbleElRef}
          role="toolbar"
          aria-label="选中文字操作"
          className="zj-sel-bubble flex items-center gap-1"
          style={{
            left: bubblePos.x,
            top: bubblePos.top,
            transform: 'translate(-50%, 0)'
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
          {anno && (
            <button onClick={dispatchAnno} title="给选中文字添加批注（供批注优化生成修改提案）" aria-label="添加批注">
              <MessageSquareText className="h-3.5 w-3.5" />
              批注
            </button>
          )}
        </div>
      )}
      {annoPop && annoPopRow && annoPopPos && (
        <div
          ref={annoPopElRef}
          className="zj-anno-pop"
          role="group"
          aria-label="批注"
          style={{
            left: annoPopPos.x,
            top: annoPopPos.top,
            transform: 'translate(-50%, 0)'
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
                focusEditor()
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
                focusEditor()
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
