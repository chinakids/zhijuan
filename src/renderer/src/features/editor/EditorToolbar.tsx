import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ComponentType } from 'react'
import {
  Bold, Code, Ellipsis, Heading1, Heading2, Heading3, Italic, List, ListOrdered, Pilcrow, Quote, Undo2, Redo2
} from 'lucide-react'
import { editorViewCtx } from '@milkdown/kit/core'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'
import { setBlockType, toggleMark } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history'
import { computeHideCount, MORE_W, type ToolGroup, type ToolItem } from './toolbarLayout'
import { EMPTY_ACTIVE, type ActiveState } from './toolbarActive'

/** 撤销/重做可用态（HIG Menus/Toolbars：不可用项置灰示态、不响应交互，但不隐藏） */
type HistState = { canUndo: boolean; canRedo: boolean }

/** 编辑器工具栏（Apple HIG Toolbars 对齐）：
 *  - 符号优先、无边框、哑光低调；与「暖纸面+精密中性铬」设计语言共存；
 *  - 窄窗放不下时，低频动作自动收进「⋯」More 菜单（HIG：主区只留最重要项、More 收纳次要项），
 *    容器宽度 ResizeObserver 实测；离屏测量层全量渲染（隐藏项也能量到宽）。
 *  - 格式工具（标题/加粗/列表…）是 toggle 按钮（HIG Buttons：macOS 方形符号按钮可配置为 toggle 行为；
 *    系统保留专门视觉传达 toggled 状态）——光标位于该格式内时按钮呈激活态（aria-pressed + accent-soft 底，
 *    与全站选中态口径一致；Pages/TextEdit 先例）。激活态由 Prose 侧 selection 级快照（toolbarActive.ts）驱动。
 * 纯逻辑在 toolbarLayout.ts（computeHideCount），vitest 单测覆盖。 */

type EditorLike = { action: (fn: (ctx: any) => void) => void }

export default function EditorToolbar({
  edRef,
  histTick = 0,
  active = null
}: {
  edRef: MutableRefObject<EditorLike | null>
  /** Prose 在 markdownUpdated 时递增；工具栏据此重读撤销/重做可用态 */
  histTick?: number
  /** 当前光标处格式激活快照（Prose 侧 selection 级更新；null=编辑器未就绪，视为全灭） */
  active?: ActiveState | null
}) {
  const groupsRef = useRef<ToolGroup[] | null>(null)
  const hidePriorityRef = useRef<number[] | null>(null)
  if (!groupsRef.current) {
    const item = (
      key: string,
      name: string,
      icon: ComponentType<{ className?: string }>,
      fn: (v: any, s: any) => void,
      disabled?: (h: HistState) => boolean,
      active?: (a: ActiveState) => boolean
    ): ToolItem => ({ key, name, icon, run: fn, disabled, active })
    groupsRef.current = [
      {
        key: 'g-block',
        items: [
          item('h1', '一级标题', Heading1, (v, s) => setBlockType(s.nodes.heading, { level: 1 })(v.state, v.dispatch), undefined, (a) => a.block === 'heading1'),
          item('h2', '二级标题', Heading2, (v, s) => setBlockType(s.nodes.heading, { level: 2 })(v.state, v.dispatch), undefined, (a) => a.block === 'heading2'),
          item('h3', '三级标题', Heading3, (v, s) => setBlockType(s.nodes.heading, { level: 3 })(v.state, v.dispatch), undefined, (a) => a.block === 'heading3'),
          item('para', '正文段落', Pilcrow, (v, s) => setBlockType(s.nodes.paragraph)(v.state, v.dispatch), undefined, (a) => a.block === 'paragraph')
        ]
      },
      {
        key: 'g-inline',
        items: [
          item('bold', '加粗', Bold, (v, s) => toggleMark(s.marks.strong)(v.state, v.dispatch), undefined, (a) => a.marks.strong),
          item('italic', '斜体', Italic, (v, s) => toggleMark(s.marks.em)(v.state, v.dispatch), undefined, (a) => a.marks.em),
          item('code', '行内代码', Code, (v, s) => toggleMark(s.marks.code)(v.state, v.dispatch), undefined, (a) => a.marks.code),
          item('quote', '引用块', Quote, (v, s) => setBlockType(s.nodes.blockquote)(v.state, v.dispatch), undefined, (a) => a.block === 'blockquote'),
          item('ul', '无序列表', List, (v, s) => wrapInList(s.nodes.bullet_list)(v.state, v.dispatch), undefined, (a) => a.block === 'bullet_list'),
          item('ol', '有序列表', ListOrdered, (v, s) => wrapInList(s.nodes.ordered_list)(v.state, v.dispatch), undefined, (a) => a.block === 'ordered_list')
        ]
      },
      {
        key: 'g-history',
        items: [
          item('undo', '撤销', Undo2, (v) => undo(v.state, v.dispatch), (h) => !h.canUndo),
          item('redo', '重做', Redo2, (v) => redo(v.state, v.dispatch), (h) => !h.canRedo)
        ]
      }
    ]
    // 隐藏顺序（低频→高频）：行内代码/引用/列表 → 斜体/加粗 → 撤销/重做 → 标题/段落
    const flat = groupsRef.current.flatMap((g) => g.items)
    hidePriorityRef.current = ['code', 'quote', 'ol', 'ul', 'italic', 'bold', 'redo', 'undo', 'h3', 'h2', 'h1', 'para']
      .map((k) => flat.findIndex((it) => it.key === k))
      .filter((i) => i >= 0)
  }
  const groups = groupsRef.current!
  const HIDE_PRIORITY = hidePriorityRef.current!
  const flat = groups.flatMap((g) => g.items)

  /** 撤销/重做可用态：edRef 就绪后读 ProseMirror history 插件深度；histTick 变化（文档变更）时重读 */
  const hist = useMemo<HistState>(() => {
    const e = edRef.current
    if (!e) return { canUndo: false, canRedo: false }
    let st: any = null
    try {
      e.action((ctx: any) => {
        st = ctx.get(editorViewCtx).state
      })
    } catch {
      return { canUndo: false, canRedo: false }
    }
    if (!st) return { canUndo: false, canRedo: false }
    return { canUndo: undoDepth(st) > 0, canRedo: redoDepth(st) > 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edRef, histTick])

  const barRef = useRef<HTMLDivElement>(null)
  const measureRefs = useRef<Record<string, HTMLElement | null>>({})
  const [hiddenCount, setHiddenCount] = useState(0)

  const recompute = useCallback(() => {
    const bar = barRef.current
    if (!bar) return
    const cs = getComputedStyle(bar)
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    // 极窄（内容区被侧栏挤没）时也要让 More 可用：预算下限 = 至少 More 一个按钮（HIG：每个动作都可达）
    const avail = Math.max(bar.clientWidth - pad, MORE_W)
    const widths = flat.map((it) => measureRefs.current[it.key]?.offsetWidth ?? 24)
    const next = computeHideCount(widths, HIDE_PRIORITY, groups, avail)
    setHiddenCount((s) => (s === next ? s : next))
  }, [flat, groups, HIDE_PRIORITY])

  useLayoutEffect(() => {
    recompute()
    const bar = barRef.current
    if (!bar) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(bar)
    return () => ro.disconnect()
  }, [recompute])

  const hiddenSet = new Set(HIDE_PRIORITY.slice(0, hiddenCount))
  const groupVisible = (gi: number): boolean => groups[gi].items.some((it) => !hiddenSet.has(flat.indexOf(it)))
  const actState = active ?? EMPTY_ACTIVE

  const runTool = (t: ToolItem) => {
    if (t.disabled?.(hist)) return
    const e = edRef.current
    if (!e) return
    try {
      e.action((ctx: any) => {
        const view = ctx.get(editorViewCtx)
        t.run(view, view.state.schema)
        view.focus()
      })
    } catch {
      /* 编辑器还没就绪时忽略 */
    }
  }

  const renderItem = (t: ToolItem) => {
    const dis = t.disabled?.(hist) ?? false
    const act = t.active ? t.active(actState) : false
    return (
      <button
        key={t.key}
        title={t.name}
        aria-label={t.name}
        disabled={dis}
        aria-pressed={t.active ? act : undefined}
        onClick={() => runTool(t)}
        className={`zj-tb-item shrink-0${dis ? ' zj-tb-off' : ''}${t.active && act ? ' zj-tb-on' : ''}`}
      >
        <t.icon className="h-4 w-4" />
      </button>
    )
  }

  const hiddenTools = flat.filter((it) => hiddenSet.has(flat.indexOf(it)))

  return (
    <div ref={barRef} className="zj-md-toolbar">
      {/* 测量层：全量渲染、离屏不可交互；ResizeObserver 重算时读真实按钮宽 */}
      <div
        aria-hidden
        data-zj-tb-measure="1"
        className="pointer-events-none absolute left-[-9999px] top-0 flex items-center"
        style={{ visibility: 'hidden' }}
      >
        {groups.map((g, gi) => (
          <span key={g.key} className="contents">
            {gi > 0 && <span className="sep" />}
            {g.items.map((t) => (
              <button key={t.key} ref={(el) => { measureRefs.current[t.key] = el }} className="zj-tb-item" tabIndex={-1}>
                <t.icon className="h-4 w-4" />
              </button>
            ))}
          </span>
        ))}
      </div>
      {groups.map((g, gi) => {
        const hasVisible = groupVisible(gi)
        if (!hasVisible) return null
        const showSep = gi > 0 && groups.slice(0, gi).some((x, xi) => groupVisible(xi))
        return (
          <span key={g.key} className="contents">
            {showSep && <span className="sep shrink-0" />}
            {g.items.map((t) => (hiddenSet.has(flat.indexOf(t)) ? null : renderItem(t)))}
          </span>
        )
      })}
      {hiddenTools.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button title="更多格式" aria-label="更多格式" className="zj-tb-item shrink-0">
              <Ellipsis className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {hiddenTools.map((t, i) => {
              const prev = hiddenTools[i - 1]
              const needSep = prev
                ? groups.findIndex((g) => g.items.includes(t)) !== groups.findIndex((g) => g.items.includes(prev))
                : false
              const dis = t.disabled?.(hist) ?? false
              const act = t.active ? t.active(actState) : false
              return (
                <div key={t.key}>
                  {needSep && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    disabled={dis}
                    onSelect={() => runTool(t)}
                    className={`text-xs ${act && !dis ? 'text-accent' : 'text-ink-2'}`}
                  >
                    <t.icon className={`mr-2 h-3.5 w-3.5 ${act && !dis ? 'text-accent' : 'text-ink-3'}`} />
                    <span>{t.name}</span>
                  </DropdownMenuItem>
                </div>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
