import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useOutletContext } from 'react-router-dom'
import { Plus, BookOpen, PanelLeftOpen, PanelLeftClose, X, MoreHorizontal } from 'lucide-react'
import LoadingIndicator from '../components/LoadingIndicator'
import type { ChapterEntry, ChapterCheckKind, UnlistedHit, MissingHit } from '../../../shared/types'
import { serializeFrontMatter, addFrontMatterListItem, removeFrontMatterListItem } from '../../../shared/fmatter'
import { chapterLine, DEFAULT_LINE, prefillSource } from '../../../shared/line'
import type { LineInfo } from '../../../shared/line'
import { shouldCollapseChapterList, AGENT_PANEL_DEFAULT_WIDTH } from '../../../shared/uiPrefs'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/EmptyState'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { cn } from '../lib/utils'
import { isImeComposing } from '../lib/ime'
import DocEditor from '../features/editor/DocEditor'
import HealthBar from '../features/audit/HealthBar'
import { runSliceSync } from '../features/sync/sliceSync'
import { useColFold } from '../features/common/useColFold'
import { describeSyncEvidence } from '../../../shared/syncEvidence'
import { GuardIssuesNote } from '../features/sync/GuardIssues'
import type { SyncIssue } from '../../../shared/types'
import { useProposalStore } from '../store/proposals'
import { useDocTitleStore } from '../store/docTitle'
import { useUiStore } from '../store/ui'
import type { ProseApi } from '../features/editor/Prose'
import AgentPanel from '../features/agent/AgentPanel'
import ChapterCheckDrawer from '../features/check/ChapterCheckDrawer'
import { useFsChanged, useFsEvents } from '../features/fs/useFsEvents'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { FieldError, fieldInvalidClass } from '../components/ui/field-error'
import { toast } from '../store/toasts'
import type { AnnotationRow } from '../../../shared/annotations'

export default function Novel() {
  const { id = '' } = useParams()
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  // 应用级「当前写作章」（2026-09-20 体验层）：sel 直接从 useUiStore 派生——单一源无本地镜像，
  // 跨路由/跨项目切回自然恢复（store 记最近上下文，按 projectId 过滤；写入统一走 setSel）。
  const chapterSel = useUiStore((s) => s.currentChapter)
  const sel = chapterSel && chapterSel.projectId === id ? chapterSel.file : null
  const setSel = useCallback((v: string | null) => {
    useUiStore.getState().setCurrentChapter(v ? { projectId: id, file: v } : null)
  }, [id])
  // 多线项目章项线徽标（多时间线叙事 2026-09-16）：线数 >1 才显示（单线零打扰）；章节线名权威口径 shared/line.chapterLine
  const multiLine = useMemo(() => {
    const s = new Set<string>()
    for (const c of chapters) if (c.fm) s.add(chapterLine(c.fm))
    return s.size > 1
  }, [chapters])
  // 划词批注弹层（主人 2026-09-12：编辑器划词 → 填写批注意图 → 写入 *_批注.csv）
  const [annoTarget, setAnnoTarget] = useState<{ loc: string; before: string } | null>(null)
  const [annoNote, setAnnoNote] = useState('')
  const [annoSaving, setAnnoSaving] = useState(false)
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ loc: string; before: string }>).detail
      if (typeof d?.before === 'string' && d.before.trim()) {
        setAnnoTarget({ loc: d.loc ?? '', before: d.before.trim() })
        setAnnoNote('')
      }
    }
    window.addEventListener('zj:anno-compose', h)
    return () => window.removeEventListener('zj:anno-compose', h)
  }, [])
  async function saveAnno() {
    if (!annoTarget || !sel) return
    setAnnoSaving(true)
    try {
      const r = await window.zhijuan.annotationAdd(id, '正文/' + sel, {
        loc: annoTarget.loc,
        before: annoTarget.before,
        note: annoNote.trim() || '修改此处'
      })
      if (r.ok) {
        toast.add({ kind: 'success', title: '批注已添加', description: `已写入 ${r.csvRel}（第 ${r.row} 行）；批注优化扫描后会生成修改提案` })
        void loadAnnotations() // 即时在编辑器中高亮新批注
      } else {
        toast.add({ kind: 'error', title: '批注添加失败', description: '写入批注文件失败' })
      }
    } catch (e) {
      toast.add({ kind: 'error', title: '批注添加失败', description: String((e as Error).message ?? e) })
    } finally {
      setAnnoSaving(false)
      setAnnoTarget(null)
    }
  }
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [title, setTitle] = useState('')
  const [slice, setSlice] = useState('')
  const [cast, setCast] = useState('')
  // 建章向导「时间线」（多时间线叙事 2026-09-16，周增量任务 #3）：预填上一章线；可手输新线；已有线快捷 chips（线数>1 才显示）
  const [timeLine, setTimeLine] = useState('')
  const [lineOpts, setLineOpts] = useState<LineInfo[]>([])
  const [goal, setGoal] = useState('') // 本章目标
  const [conflict, setConflict] = useState('')
  const [plot, setPlot] = useState('') // 关键事件
  const [hook, setHook] = useState('')
  const events = useFsEvents(id)
  const apiRef = useRef<ProseApi | null>(null)
  const [syncMsg, setSyncMsg] = useState('')
  // 浮条 6s 自动清除定时器句柄（synctimer）：新同步状态必须清旧 timer——
  // 防「6s 内二次保存」旧 timer 提前清新提示，也防「成功→失败」旧 timer 把常驻失败提示清掉（失败可感知可重试语义）
  const syncTimer = useRef<number | null>(null)
  // 同章同步在途防护（2026-09-22 创作层候选 3）：切片同步是真模型调用（30s~min 级），作者在同步进行中
  // 再次保存（改错别字/续写）若直接再触发=并发双跑（P1 排查看 09:29:18/09:30:14 两个并发 runSync 会话实锤）。
  // 语义=GitHub Actions concurrency 同构：同一 group 同时最多一个在跑、新请求 pending 且「只留最新」
  // （新的替换等待中的）；排队串行重跑保证「最新保存内容」最终必被比对（不丢最终态），
  // 避免模型重复调用与浮条「同步中→✓→同步中→✓」闪烁。
  const syncRunRef = useRef<{ rel: string; p: Promise<unknown> } | null>(null)
  const syncQueuedRef = useRef(false)
  // 守卫拦截（target 存在性防线）：浮条「查看」可展开完整明细（正文为源、设定为流，拦截需作者判断是否补档案）
  const [syncIssues, setSyncIssues] = useState<SyncIssue[]>([])
  // 切片同步失败后的就地重试（03:45 观察②→06:45 候选 2）：失败浮条不随 6s 自动清，留「重试同步」按钮
  const [syncRetry, setSyncRetry] = useState<{ rel: string } | null>(null)
  // 「同款待确认」直达定位（2026-09-20 候选 3 可行动性）：未处置复用旧卡的提案 id——
  // 跨章聚合后提示在章 B、卡可能在章 A，浮条「查看提案」按钮打开提案抽屉并定位该卡
  const [keptFocus, setKeptFocus] = useState<string | undefined>(undefined)
  const [checkOpen, setCheckOpen] = useState(false)
  // 本章小环 tab（短巡查/分层修订）：AgentPanel 命令行 /巡查 [修订] 可切换后打开
  const [checkTab, setCheckTab] = useState<ChapterCheckKind>('chapter')
  // 章列行项操作（⋯菜单 与 右键菜单 共享同一入口集；HIG Context menus「items available in the main interface, too」）
  const [renaming, setRenaming] = useState<ChapterEntry | null>(null)
  const [renameVal, setRenameVal] = useState('')
  // 重命名字段级错误（HIG 就近反馈；输入即清、修正后消失；取代右上角 toast 一闪而过）
  const [renameErr, setRenameErr] = useState('')
  // 章节「切片」名修改（约定头字段编辑收口）：正文约定头 + 大纲副产物 fm 同步 + 旧切片提案置 stale
  const [sliceEditing, setSliceEditing] = useState<ChapterEntry | null>(null)
  const [sliceVal, setSliceVal] = useState('')
  const [deleting, setDeleting] = useState<ChapterEntry | null>(null)
  // 切章未保存守卫（2026-09-23 创作层）：dirty 时点其他章节 → 确认（保存并切换/不保存切换/取消），
  // 防「写了一半点错章/随手切章丢稿」。dirtyRef 由 DocEditor onDirty 实时维护（只读，不参与保存行为）。
  const dirtyRef = useRef(false)
  const saveHandleRef = useRef<(() => Promise<boolean>) | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // 窄窗正文保护（2026-09-14 体验层；HIG Sidebars「随窗口缩放自动隐藏/显示侧栏」）：
  // 正文可用宽 <360px 时折叠章节列，改由「章节列表」浮层访问；Agent 面板拖宽会抬高阈值（正文始终受保护）
  const [winW, setWinW] = useState<number>(() => window.innerWidth)
  const [chapOpen, setChapOpen] = useState(false)
  // 宽窗手动折叠（2026-09-18 体验层；HIG Sidebars「let people hide and show the sidebar」）：
  // 与 narrow 正交——窄窗=自动（渲染判据），宽窗=作者主动收起；折叠态持久化=AppSettings（macOS 先例跨重启记住侧栏）
  const [chapHidden, setChapHidden] = useColFold('novel')
  const agentWd = useUiStore((s) => s.agentPanelWidth) ?? AGENT_PANEL_DEFAULT_WIDTH
  const narrow = shouldCollapseChapterList(winW, agentWd)
  const effectiveNarrow = narrow || chapHidden
  const chapRef = useRef<HTMLDivElement | null>(null)
  const prevSelRef = useRef<string | null>(sel)
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // 选章后 / 变回宽窗时自动收起浮层（浮层语义＝临时层，选中即消失——HIG Popovers；仅在 sel 发生变化时触发）
  useEffect(() => {
    if (chapOpen && prevSelRef.current !== sel) setChapOpen(false)
    prevSelRef.current = sel
  }, [sel, chapOpen])
  useEffect(() => {
    if (!narrow && chapOpen) setChapOpen(false)
  }, [narrow, chapOpen])
  // Esc 关闭章节浮层（bubble 阶段：Prose 已处理查找条/浮层层级，模态抽屉由 useModalA11y 先行）
  useEffect(() => {
    if (!chapOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setChapOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chapOpen])
  // 菜单收起：点击菜单外任意处 / Esc；菜单项操作后各自关闭
  // （自研 div 菜单已被 Radix ContextMenu/DropdownMenu 取代：外部点击/Esc/键盘导航由 Radix 自带）

  // 项目引导「现在新建第一章」：Workspace 经 Outlet context 发信号（递增计数），打开建章对话框
  const outletCtx = useOutletContext<{ newChapterReq?: number }>()
  const newChapterReq = outletCtx?.newChapterReq ?? 0
  // 保存时的「涉及人物清单与正文不一致」前置提示（本地规则·零模型）：出场未列入(unlisted) / 列入未出场(missing)
  // 命中且未忽略才显示；忽略记本会话内不再提示本章
  const [castCard, setCastCard] = useState<{ rel: string; unlisted: UnlistedHit[]; missing: MissingHit[] } | null>(null)
  const dismissedCast = useRef(new Set<string>())
  const [searchParams, setSearchParams] = useSearchParams()
  // 命令面板「打开章节」：?ch=<章节裸名>（相对 正文/）进入后自动选中
  const chParam = searchParams.get('ch')
  useEffect(() => {
    if (!chParam) return
    if (!chapters.some((c) => c.file === chParam)) return
    setSel(chParam)
    setSearchParams({}, { replace: true })
  }, [chParam, chapters, setSearchParams])

  // 「上一章」＝约定头章号最大的章（连续写作流：新章切片名/涉及人物默认沿用，可改）
  // 选法按 fm 章号而非列表尾部：导入/手改过的文件名与约定头章号可能不一致，fm 才是权威
  const prevChapter = useMemo(() => {
    let best: ChapterEntry | null = null
    for (const c of chapters) {
      const n = c.fm?.['章号']
      if (typeof n !== 'number') continue
      if (!best || n > (best.fm?.['章号'] as number)) best = c
    }
    return best
  }, [chapters])

  // 建章预填基准（2026-09-17：多线项目建章预填按选中章线评估，候选 2）——决策源=shared/line.prefillSource：
  // 仅当「选中章存在且其线≠最新章线」时跟随选中章（作者当前工作上下文），否则维持最新章（零回归）。
  // 基准作用于「一章整体」：切片名/时间线/涉及人物三字段同源，避免线与切片不配套的预填。
  const selChapter = useMemo(() => chapters.find((c) => c.file === sel), [chapters, sel])
  const prefill = useMemo(() => {
    const viaSel =
      prefillSource(
        selChapter ? chapterLine(selChapter.fm) : null,
        prevChapter ? chapterLine(prevChapter.fm) : null
      ) === 'selection'
    return { chapter: viaSel ? selChapter : prevChapter, viaSel }
  }, [selChapter, prevChapter])
  const prefillChapter = prefill.chapter

  // 打开建章对话框：有预填基准章时预填切片名、时间线与涉及人物（都在各自输入框里可改）
  const openCreate = useCallback(() => {
    const pf = prefillChapter?.fm
    setSlice(typeof pf?.['切片'] === 'string' ? pf['切片'] : '')
    setCast(Array.isArray(pf?.['涉及人物']) ? pf['涉及人物'].join('，') : '')
    // 预填基准章线（chapterLine 归一：未写字段=主线；来源=prefillSource 决策，非简单「上一章」）
    setTimeLine(prefillChapter ? chapterLine(prefillChapter.fm) : '')
    setCreating(true)
    // 已有线枚举（正文为源现扫；失败静默——手输兜底，枚举只是快捷选择，不挡建章）
    if (id) {
      window.zhijuan.listLines(id).then(setLineOpts).catch(() => setLineOpts([]))
    }
  }, [prefillChapter, id])

  // 项目引导「现在新建第一章」：经 Outlet context 发信号（递增计数），打开建章对话框（无上一章则空开）
  useEffect(() => {
    if (newChapterReq > 0) openCreate()
  }, [newChapterReq, openCreate])

  // 系统菜单 文件→新建章节…（MenuBridge 单点分发 → 本页监听；openCreate 用 ref 取最新闭包）
  const openCreateRef = useRef(openCreate)
  openCreateRef.current = openCreate
  useEffect(() => {
    const h = () => openCreateRef.current()
    window.addEventListener('zj:menu-newChapter', h)
    return () => window.removeEventListener('zj:menu-newChapter', h)
  }, [])

  // 归属校验（2026-09-22 创作层候选 3）：同步结果反馈只落在「发起章」——同步在途（真模型 30s~min 级）
  // 时作者切到另一章，完成的 setSyncMsg/重试/守卫明细若照常写入=旧章结果落错页（作者会误以为
  // 当前章刚同步过/失败了；失败重试按钮还会在别章页上触发旧章同步）。语义=React 官方 race condition
  // 修复「ignore stale responses」同构（react.dev/learn/you-might-not-need-an-effect）：过期结果丢弃，
  // 仅在「发起上下文仍为当前上下文」时应用；数据动作（提案台 bump/排队重跑）不受归属影响、仍执行。
  const syncOwned = useCallback(
    (rel: string): boolean => {
      const cur = useUiStore.getState().currentChapter
      return !!cur && cur.projectId === id && '正文/' + cur.file === rel
    },
    [id]
  )

  // 切片同步核心（保存正文/失败重试共用同链路：runSliceSync 直调，成功后提案台 bump）
  const doSync = useCallback(
    async (rel: string) => {
      if (!id) return
      // 同章同步在途：并入队列（同步完成后再串行重跑最新保存内容），不立即并发（见 syncRunRef 注释）
      const cur = syncRunRef.current
      if (cur && cur.rel === rel) {
        syncQueuedRef.current = true
        // 排队态明示（NN/g #1「keep users informed」）：作者在途期再保存=已被接住、完成后将补比对最新内容，
        // 消除「这次保存是不是白存/没被记录」的不确定（NN/g 原句=缺反馈会让人重复点按同一操作）
        if (syncOwned(rel)) setSyncMsg('切片同步中… · 新保存已排队，完成后将再比对')
        return
      }
      // 归属门：仅当作者仍在该章时更新浮条/重试/守卫明细（排队补跑可能在作者已切走的页面上启动）
      if (syncOwned(rel)) {
        // 新同步状态开始前：清掉上一轮残存的自动清除 timer（竞态修复，见 syncTimer 注释）
        if (syncTimer.current !== null) {
          window.clearTimeout(syncTimer.current)
          syncTimer.current = null
        }
        setSyncMsg('切片同步中…')
        setSyncRetry(null)
        setSyncIssues([])
        setKeptFocus(undefined)
      }
      const run = (async () => {
        const r = await runSliceSync(id, rel)
        const owned = syncOwned(rel) // 完成时刻归属校验：作者已切走则丢弃反馈（数据动作不受影响）
        if (r.ok) {
          // 「无设定变化」追加比对基准证据（2026-09-14 21:45）：确认同步真跑了、基准是什么；
          // 2026-09-20 候选 3：被抑制的同款（此前已拒绝）是「作者已裁决」，不能报成「无设定变化」；
          // kept=同款未处置（同章已有 pending/stale）复用旧卡，同样不是「无设定变化」
          const sup = r.suppressed ?? 0
          const kept = r.kept ?? 0
          const supNote = sup > 0 ? ` · 同款 ${sup} 条此前已拒绝，未重复提案` : ''
          const keptNote = kept > 0 ? ` · 同款 ${kept} 条待确认，未重复提案` : ''
          if (owned) {
            setSyncIssues(r.issues ?? [])
            setSyncMsg(
              r.items > 0
                ? `✓ 已生成 ${r.items} 条切片提案${supNote}${keptNote}`
                : sup > 0 || kept > 0
                  ? `✓ 无新动向${supNote}${keptNote}${describeSyncEvidence(r.evidence)}`
                  : `✓ 无设定变化${describeSyncEvidence(r.evidence)}`
            )
            if (kept > 0) setKeptFocus(r.keptIds?.[0])
            syncTimer.current = window.setTimeout(() => {
              setSyncMsg('')
              syncTimer.current = null
            }, 6000)
          }
          useProposalStore.getState().bump()
        } else {
          // 失败可感知：浮条留存（不随 6s 清），并提供就地重试按钮（仅在作者仍在发起章时呈现）
          if (owned) {
            setSyncMsg('✗ 切片同步失败: ' + r.error)
            setSyncRetry({ rel })
          }
        }
      })()
      syncRunRef.current = { rel, p: run }
      try {
        await run
      } finally {
        if (syncRunRef.current?.p === run) syncRunRef.current = null
        // 在途期间有新保存（queued）→ 串行重跑一次（读盘=最新保存内容；只留最新=多保存也只补一次）
        if (syncQueuedRef.current) {
          syncQueuedRef.current = false
          void doSync(rel)
        }
      }
    },
    [id]
  )

  const handleChapterSaved = useCallback(
    (rel: string) => {
      if (!id) return
      // 前置快检（零模型；与同步并行）：正文出现档案人物本名/登记别名但约定头未列（unlisted）、
      // 约定头列了但正文（达到最小字数阈值后）未出现本名/别名（missing）→ 汇总为一张提示卡
      void Promise.all([
        window.zhijuan.checkChapterUnlisted(id, rel),
        window.zhijuan.checkChapterMissing(id, rel)
      ]).then(([u, m]) => {
        const unlisted = u.ok ? u.items : []
        const missing = m.ok ? m.items : []
        if ((unlisted.length || missing.length) && !dismissedCast.current.has(rel)) {
          setCastCard({ rel, unlisted, missing })
        }
      })
      void doSync(rel)
    },
    [id, doSync]
  )

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const list = await window.zhijuan.listChapters(id)
      setChapters(list)
      setLoadErr('')
      // 校正 store 中记录的当前章（派生 sel 无本地态）：本项目的记录若已不在列表（被删/外部变更）则清空
      const cur = useUiStore.getState().currentChapter
      if (cur && cur.projectId === id && !list.some((c) => c.file === cur.file)) {
        useUiStore.getState().setCurrentChapter(null)
      }
    } catch (e) {
      setLoadErr(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [id])

  // 批注显示（F-20260912-04 后半）：读取本章 *_批注.csv → 编辑器高亮 + 底部计数徽标。
  // 读失败静默：显示是增强，不影响编辑；csv 不存在返回空。
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([])
  const loadAnnotations = useCallback(async () => {
    if (!id || !sel) {
      setAnnotations([])
      return
    }
    try {
      setAnnotations(await window.zhijuan.annotationList(id, '正文/' + sel))
    } catch {
      setAnnotations([])
    }
  }, [id, sel])
  useEffect(() => {
    void loadAnnotations()
  }, [loadAnnotations])
  // csv（批注文件）被外部改写（如 Hermes 侧批注脚本）→ 刷新显示
  const annoEvents = useMemo(() => events.filter((e) => e.path.endsWith('_批注.csv')).length, [events])
  useEffect(() => {
    if (annoEvents > 0) void loadAnnotations()
  }, [annoEvents, loadAnnotations])
  // 批注气泡「删除该批注」（体验层 2026-09-13）→ 删 csv 行（与批注脚本 remove/cull 同语义）→ 刷新高亮
  useEffect(() => {
    const h = (e: Event) => {
      const row = (e as CustomEvent<{ row: number }>).detail?.row
      if (typeof row !== 'number' || !sel) return
      void (async () => {
        try {
          const r = await window.zhijuan.annotationRemove(id, '正文/' + sel, row)
          if (r.ok) {
            toast.add({ kind: 'success', title: '批注已删除', description: r.remaining > 0 ? `剩余 ${r.remaining} 条` : '本章批注已清空' })
            void loadAnnotations()
          } else {
            toast.add({ kind: 'error', title: '删除批注失败', description: r.note || '批注行不存在' })
          }
        } catch (err) {
          toast.add({ kind: 'error', title: '删除批注失败', description: String((err as Error).message ?? err) })
        }
      })()
    }
    window.addEventListener('zj:anno-remove', h)
    return () => window.removeEventListener('zj:anno-remove', h)
  }, [id, sel, loadAnnotations])

  // 切换章节：收起「清单不一致」提示卡（忽略记录保留，本会话内不重复打扰该章）+ 同步反馈清零
  // （2026-09-22 候选 3：守卫明细/「查看提案」定位同为同步反馈，不留旧章残影——归属校验的显示面）
  useEffect(() => {
    setCastCard(null)
    if (syncTimer.current !== null) {
      window.clearTimeout(syncTimer.current)
      syncTimer.current = null
    }
    setSyncMsg('')
    setSyncRetry(null)
    setSyncIssues([])
    setKeptFocus(undefined)
  }, [sel])

  // 卸载清理：组件销毁时移除未触发的自动清除 timer（防泄漏）
  useEffect(() => {
    return () => {
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current)
    }
  }, [])

  // 「补入涉及人物」：把命中人物写进本章约定头（只改那一行，其他约定头原样；正文不动）
  async function addUnlisted() {
    if (!id || !castCard) return
    const rel = castCard.rel
    let raw = (await window.zhijuan.readDoc(id, rel)) ?? ''
    for (const h of castCard.unlisted) raw = addFrontMatterListItem(raw, '涉及人物', h.name)
    await window.zhijuan.writeDoc(id, rel, raw)
    setCastCard(null)
    await refresh()
  }

  // 「移出涉及人物」：把未出场命中人物从本章约定头移除（移空则删该行；正文不动）
  async function removeMissing() {
    if (!id || !castCard) return
    const rel = castCard.rel
    let raw = (await window.zhijuan.readDoc(id, rel)) ?? ''
    for (const h of castCard.missing) raw = removeFrontMatterListItem(raw, '涉及人物', h.name)
    await window.zhijuan.writeDoc(id, rel, raw)
    setCastCard(null)
    await refresh()
  }

  function dismissCast() {
    if (!castCard) return
    dismissedCast.current.add(castCard.rel)
    setCastCard(null)
  }

  useEffect(() => {
    // 挂载/切项目先回 loading 并清旧项目章节数据（Timeline 样板，2026-09-22 体验层 stale 核查）：
    // ⌘K 项目搜索/浏览器前进后退会让同路由组件复用，旧项目列表会在新数据返回前残留闪现。
    // fs 事件触发的 refresh 不经过本 effect（直接调 refresh），列表刷新不受影响。
    setLoading(true)
    setChapters([])
    setLoadErr('')
    void refresh()
  }, [refresh])

  // 文件变化：刷新列表
  useFsChanged(id, '正文/', () => void refresh())

  // 切项目：关闭「本章小环」抽屉（检查结果属当前章上下文；经 ⌘K 项目搜索可直接跨项目跳转，组件复用）
  useEffect(() => {
    setCheckOpen(false)
  }, [id])

  // 注意：events.path 是项目根相对路径（如 正文/第01章_雾港.md），sel 是 listChapters 返回的相对 正文/ 裸名，
  // 匹配必须用带前缀的 chapterRel 拼出来（真机 watcher 同此口径；曾直接用 sel 匹配导致 extVersion 恒 0、外部改动不静默重载）
  const extVersion = useMemo(() => (sel ? events.filter((e) => e.path === '正文/' + sel).length : 0), [events, sel])

  async function createChapter() {
    if (!id || !title.trim()) return
    const num = chapters.reduce((max, c) => Math.max(max, c.fm?.['章号'] ?? 0), 0) + 1
    const fmObj: Record<string, unknown> = {
      章号: num,
      题名: title.trim(),
      切片: slice.trim() || String(num),
      涉及人物: cast.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    }
    // 时间线：空/主线省略字段（缺省=主线，设计文档 §4.2 零迁移零冗余）；非主线写入约定头
    const lineTrim = timeLine.trim()
    if (lineTrim && lineTrim !== DEFAULT_LINE) fmObj['时间线'] = lineTrim
    const fm = serializeFrontMatter(fmObj)
    const name = `第${String(num).padStart(2, '0')}章_${title.trim()}.md`
    // 故事要素：有任何一项就写入文首指引块（随正文进入切片同步与 agent 上下文）
    const eles = [
      { k: '目标', v: goal },
      { k: '核心冲突', v: conflict },
      { k: '关键事件', v: plot },
      { k: '前情呼应', v: hook }
    ].filter((x) => x.v.trim())
    const titleLine = `# ${title.trim()}\n`
    const body = eles.length
      ? '> == 本章故事要素 ==\n' +
        eles.map((x) => `> - ${x.k}：${x.v.trim()}`).join('\n') +
        '\n>\n> （本章写作指引：可随进度修改；保存后随正文进入切片同步与 agent 上下文）\n\n' +
        titleLine
      : titleLine
    try {
      await window.zhijuan.writeDoc(id, `正文/${name}`, fm + body)
    } catch (e) {
      toast.add({ kind: 'error', title: '创建章节失败', description: String((e as Error).message ?? e) })
      return
    }
    setCreating(false)
    setTitle('')
    setSlice('')
    setCast('')
    setTimeLine('')
    setGoal('')
    setConflict('')
    setPlot('')
    setHook('')
    await refresh()
    setSel(name)
  }

  // 建章对话框：单行字段 Enter=创建（HIG Buttons「primary button responds to the Return key」+ 2a7dfd0 新建文档先例；
  // IME 组合期 Enter 只确认候选不提交，ime.ts 单一来源守卫；多行 Textarea 保持换行语义不接）
  const fieldEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (title.trim()) void createChapter()
    }
  }

  // ---- 章节右键菜单操作（§6.2）----
  async function doRename() {
    if (!id || !renaming) return
    setRenameErr('')
    let r: Awaited<ReturnType<typeof window.zhijuan.renameChapter>>
    try {
      r = await window.zhijuan.renameChapter(id, '正文/' + renaming.file, renameVal)
    } catch (e) {
      // IPC/主进程异常（磁盘等）：对话框内就近提示，不静默丢反馈
      setRenameErr('重命名失败：' + String((e as Error).message ?? e))
      return
    }
    if (!r.ok) {
      // 字段级校验错误：就近展示（HIG 及时反馈），对话框保持打开供修正
      setRenameErr('重命名失败：' + (r.error ?? '未知原因'))
      return
    }
    await refresh()
    // 重命名迁移了提案的 chapter 指针（migrateChapter），刷新顶栏计数与抽屉
    void useProposalStore.getState().refresh(id)
    // 重命名的是当前选中章 → 选中跟随新文件名；否则保持原选中
    if (sel === renaming.file && r.newRel) setSel(r.newRel.split('/').pop()!)
    setRenaming(null)
    toast.add({ kind: 'success', title: '已重命名', description: r.newRel })
  }
  async function doEditSlice() {
    if (!id || !sliceEditing) return
    let r: Awaited<ReturnType<typeof window.zhijuan.editChapterSlice>>
    try {
      r = await window.zhijuan.editChapterSlice(id, '正文/' + sliceEditing.file, sliceVal)
    } catch (e) {
      toast.add({ kind: 'error', title: '修改切片名失败', description: String((e as Error).message ?? e) })
      return
    }
    if (!r.ok) {
      toast.add({ kind: 'error', title: '修改切片名失败', description: r.error })
      return
    }
    setSliceEditing(null)
    await refresh()
    // 编辑切片名会把该章 slice-sync 的 pending 提案置 stale（锚点携带旧切片名），刷新顶栏计数与抽屉
    void useProposalStore.getState().refresh(id)
    toast.add({
      kind: 'success',
      title: '已更新切片名',
      description: `${r.newSlice}${r.synced ? `（已同步 ${r.synced} 篇大纲副产物）` : ''}${r.staled ? `；${r.staled} 条旧切片提案已过期` : ''}；旧切片设定已保留为历史、不再参与后续同步`
    })
  }
  async function doDelete() {
    if (!id || !deleting) return
    let r: Awaited<ReturnType<typeof window.zhijuan.deleteChapter>>
    try {
      r = await window.zhijuan.deleteChapter(id, '正文/' + deleting.file)
    } catch (e) {
      toast.add({ kind: 'error', title: '删除失败', description: String((e as Error).message ?? e) })
      return
    }
    if (!r.ok) {
      toast.add({ kind: 'error', title: '删除失败', description: r.error })
      return
    }
    toast.add({
      kind: 'success',
      title: '已移入废纸篓（可恢复）',
      description: `${deleting.name}${r.cleaned ? `（含 ${r.cleaned} 篇大纲副产物）` : ''}`
    })
    setDeleting(null)
    await refresh()
    // 删除会 invalidateChapter（置 stale），刷新顶栏计数与抽屉（.zhijuan 内变化被 DOT_DIR 过滤、无 fs 事件）
    void useProposalStore.getState().refresh(id)
    if (sel === deleting.file) setSel(null)
  }
  async function doExport(c: ChapterEntry) {
    if (!id) return
    const r = await window.zhijuan.exportChapter(id, '正文/' + c.file)
    if (r.cancelled) return
    if (!r.ok) toast.add({ kind: 'error', title: '导出失败', description: r.error })
    else toast.add({ kind: 'success', title: '已导出单章', description: r.path })
  }

  // 切章守卫（2026-09-23 创作层）：当前章有未保存改动时，点其他章节先弹确认——「保存并切换」走
  // DocEditor 的 doSave（含空写拦截等全部既有防线，true=已写盘才切）；「不保存切换」=显式丢弃；
  // 「取消」=留在本章。非 dirty 直接切（零打扰；NN/g「确认过频成路障」只在内容有风险时弹）。
  const requestSwitch = useCallback(
    (file: string) => {
      if (file === sel) return
      if (dirtyRef.current) setPendingSwitch(file)
      else setSel(file)
    },
    [sel]
  )
  // 稳定身份（DocEditor 的 onDirty effect 依赖它；只写 ref 无渲染副作用）
  const markDirty = useCallback((d: boolean) => {
    dirtyRef.current = d
  }, [])
  function discardSwitch() {
    const t = pendingSwitch
    setPendingSwitch(null)
    if (t) setSel(t)
  }
  async function saveAndSwitch() {
    const t = pendingSwitch
    setPendingSwitch(null)
    const ok = await saveHandleRef.current?.()
    // 保存被拦/失败（空写防线/IO 错，ok 非 true）：内容未落盘 → 留在本章，状态条已有原因说明，不丢内容
    if (ok === true && t) setSel(t)
  }

  // 章列行操作菜单（「⋯」下拉 与 右键 共源渲染）：HIG Context menus——两个菜单形态一致、动作一致，
  // 破坏性项（删除）置末 + danger 红字（HIG「list them at the end and identify them as destructive」）
  const renderRowMenu = (Item: React.ElementType, Sep: React.ElementType, c: ChapterEntry) => (
    <>
      <Item
        onSelect={() => {
          setRenaming(c)
          setRenameVal(String(c.fm?.['题名'] ?? ''))
          setRenameErr('')
        }}
      >
        重命名
      </Item>
      <Item
        onSelect={() => {
          setSliceEditing(c)
          setSliceVal(String(c.fm?.['切片'] ?? ''))
        }}
      >
        修改切片名
      </Item>
      <Item onSelect={() => void doExport(c)}>导出 md</Item>
      <Sep />
      <Item className="text-danger focus:bg-danger/10 focus:text-danger" onSelect={() => setDeleting(c)}>
        删除
      </Item>
    </>
  )

  const cur = chapters.find((c) => c.file === sel)
  // 章卡的 file 是相对 正文/ 的裸名；凡要当项目根相对路径传给主进程处，统一在此拼前缀（见本技能 listDocs 坑）
  const chapterRel = sel ? '正文/' + sel : ''

  // 章节列内容（侧栏与窄窗浮层共源复用；浮层额外补关闭按钮）
  const chapterHeader = (
    <div className="flex items-center justify-between px-3 pb-2 pt-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">章节</span>
      <span className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon" className="h-7 w-7" title="新建章节" aria-label="新建章节" onClick={openCreate}>
          <Plus />
        </Button>
        {!narrow && (
          <Button variant="ghost" size="icon" className="h-7 w-7" title="隐藏章节列表" aria-label="隐藏章节列表" onClick={() => setChapHidden(true)}>
            <PanelLeftClose />
          </Button>
        )}
        {narrow && (
          <Button variant="ghost" size="icon" className="h-7 w-7" title="关闭章节列表" aria-label="关闭章节列表" onClick={() => setChapOpen(false)}>
            <X />
          </Button>
        )}
      </span>
    </div>
  )
  const chapterList = (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {loading && (
        <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-ink-3">
          <LoadingIndicator size={16} />
          <span>正在读取章节…</span>
        </div>
      )}
      {!loading && loadErr && (
        <div className="px-2 py-5 text-center">
          <p className="text-xs text-danger">读取章节失败</p>
          <p className="mt-0.5 break-all text-[11px] text-ink-3">{loadErr}</p>
          <button
            className="mt-1.5 text-xs text-accent underline-offset-2 hover:underline"
            onClick={() => {
              setLoading(true)
              setLoadErr('')
              void refresh()
            }}
          >
            重试
          </button>
        </div>
      )}
      {!loading && !loadErr && chapters.length === 0 && (
        <EmptyState
          compact
          hint="还没有章节，点「新建第一章」开始写作。"
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 whitespace-nowrap text-[11px] [&_svg]:size-3"
              onClick={openCreate}
            >
              <Plus /> 新建第一章
            </Button>
          }
          dataTestId="empty-chapters"
        />
      )}
      {chapters.map((c) => (
        <ContextMenu key={c.file}>
          <ContextMenuTrigger asChild>
            <div className="group relative mb-0.5">
              <button
                onClick={() => requestSwitch(c.file)}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-lg py-2 pl-3 pr-8 text-left transition-colors',
                  sel === c.file ? 'bg-accent-soft' : 'hover:bg-surface'
                )}
              >
                <p className={cn('truncate text-sm', sel === c.file ? 'font-medium text-accent' : 'text-ink')} title={c.fm ? `第${c.fm['章号']}章 · ${c.fm['题名']}` : c.name}>
                  {c.fm ? `第${c.fm['章号']}章 · ${c.fm['题名']}` : c.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
                  {multiLine && c.fm && (
                    <span className="shrink-0 rounded bg-well px-1 py-px text-[10px] text-ink-3">{chapterLine(c.fm)}</span>
                  )}
                  <BookOpen className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate" title={`${c.fm?.['切片'] ?? '未设切片'} · ${c.wordCount} 字`}>{c.fm?.['切片'] ?? '未设切片'} · {c.wordCount} 字</span>
                </p>
              </button>
              {/* 行操作入口（HIG Context menus「Always make context menu items available in the main interface, too」+「Support context menus consistently」）：
                  「⋯」下拉与右键菜单同内容同动作；选中行常显，其他行 hover/键盘焦点时显示 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="章节操作"
                    aria-label="章节操作"
                    className={cn(
                      'absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 text-ink-3 hover:text-ink data-[state=open]:bg-well data-[state=open]:text-ink',
                      sel === c.file ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
                    )}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {renderRowMenu(DropdownMenuItem, DropdownMenuSeparator, c)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {renderRowMenu(ContextMenuItem, ContextMenuSeparator, c)}
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  )

  // 标题栏文档题名（V3）：正文页把「第N章 · 题名」上报到全局 store；组件卸载/无选中时清空
  const setDocTitle = useDocTitleStore((s) => s.setTitle)
  useEffect(() => {
    setDocTitle(cur ? `第${cur.fm?.['章号'] ?? '?'}章 · ${cur.fm?.['题名'] ?? ''}` : '')
    return () => setDocTitle('')
  }, [cur, setDocTitle])

  return (
    <div className="flex h-full min-h-0">
      {!effectiveNarrow && (
        <aside data-testid="chapter-sidebar" className="flex w-60 shrink-0 flex-col border-r border-hair bg-surface-2">
          {chapterHeader}
          {chapterList}
        </aside>
      )}

      {/* 章列行操作：右键菜单（Radix ContextMenu）与行尾「⋯」下拉（Radix DropdownMenu）共源，见 chapterList */}

      <main
        className="relative flex min-w-0 flex-1 flex-col"
        onMouseDown={(e) => {
          // 浮层为临时层：点其外任意处关闭（HIG Popovers）；Radix 菜单 portal 在 body，事件不经过本容器
          if (chapOpen && !chapRef.current?.contains(e.target as Node)) {
            setChapOpen(false)
          }
        }}
      >
        {/* 入口条：章节列已折叠（窄窗自动 / 宽窗手动）时提供「显示章节列表」入口（HIG Sidebars show/hide） */}
        {effectiveNarrow && (
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-hair px-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              data-testid="chapter-toggle"
              title="显示章节列表"
              aria-label="显示章节列表"
              onClick={() => (narrow ? setChapOpen((v) => !v) : setChapHidden(false))}
            >
              <PanelLeftOpen />
            </Button>
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">章节</span>
            <span className="flex-1" />
          </div>
        )}
        {/* 窄窗章节浮层：临时面板，选章/Esc/点外/关闭按钮收起 */}
        {narrow && chapOpen && (
          <div
            ref={chapRef}
            data-testid="chapter-drawer"
            className="absolute inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-hair bg-surface-2 shadow-[var(--shadow)]"
          >
            {chapterHeader}
            {chapterList}
          </div>
        )}
        {sel ? (
          <>
            <div className="min-h-0 flex-1">
              <DocEditor projectId={id} rel={chapterRel} withFm extVersion={extVersion} editorApiRef={apiRef} annotations={annotations} onDirty={markDirty} saveHandleRef={saveHandleRef} onSave={() => { void refresh(); void handleChapterSaved(chapterRel) }}
                statusExtra={<HealthBar projectId={id} refreshSignal={extVersion} />}
              />
            </div>
          </>
        ) : effectiveNarrow ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              art="chapter"
              title="还没有选中章节"
              hint={narrow ? '打开章节列表，选择一个章节开始写作。' : '点击上方「显示章节列表」恢复侧栏，选择一个章节开始写作。'}
              action={
                <Button onClick={() => (narrow ? setChapOpen(true) : setChapHidden(false))} data-testid="pick-chapter">
                  <PanelLeftOpen /> 打开章节列表
                </Button>
              }
              dataTestId="narrow-pick-chapter"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-3">选择左侧一个章节开始（编辑器已就绪）</div>
        )}
        {/* 切片同步结果：浮动提示，不占版面（失败带就地重试按钮，可点击） */}
        {syncMsg && (
          <div
            className={`${syncRetry ? 'pointer-events-auto' : 'pointer-events-none'} absolute right-24 top-11 z-10 flex max-w-[calc(100%-6rem)] items-center gap-2 rounded-full border border-hair bg-surface px-3 py-1 text-[11px] shadow-md`}
          >
            <span
              title={syncMsg}
              className={`pointer-events-auto min-w-0 truncate ${syncMsg.startsWith('✓') ? 'text-success' : syncMsg.startsWith('✗') ? 'text-danger' : 'text-accent'}`}
            >
              {syncMsg}
            </span>
            {syncIssues.length > 0 && <GuardIssuesNote issues={syncIssues} projectId={id} className="pointer-events-auto shrink-0" />}
            {syncRetry && (
              <button
                onClick={() => void doSync(syncRetry.rel)}
                className="shrink-0 rounded-full border border-hair px-1.5 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent-soft"
              >
                重试同步
              </button>
            )}
            {keptFocus && (
              <button
                data-testid="zj-goto-proposals"
                onClick={() => window.dispatchEvent(new CustomEvent('zj:open-proposals', { detail: { focusId: keptFocus } }))}
                className="pointer-events-auto shrink-0 rounded-full border border-hair px-1.5 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent-soft"
              >
                查看提案
              </button>
            )}
          </div>
        )}
        {/* 保存前置提示：本章「涉及人物」清单与正文不一致（本地规则·零模型）——出场未列入 / 列入未出场 */}
        {castCard && castCard.rel === chapterRel && (
          <div className="absolute right-24 top-24 z-10 w-80 rounded-lg border border-warn/50 bg-surface p-3 shadow-[var(--shadow)]">
            <p className="text-[11px] font-medium text-ink-2">本章「涉及人物」清单与正文不一致</p>
            {castCard.unlisted.length > 0 && (
              <>
                <p className="mt-1.5 text-[10px] font-medium text-ink-3">出场了却未列入</p>
                <ul className="mt-1 space-y-1 text-[11px] text-ink">
                  {castCard.unlisted.map((h) => (
                    <li key={h.name} className="break-all">
                      {h.alias ? `「${h.alias}」＝${h.name} 的登记别名，出现在正文` : `「${h.name}」的署名出现在正文`}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-ink-3">真的出场请补入；只是回忆 / 提及一笔可忽略。</p>
              </>
            )}
            {castCard.missing.length > 0 && (
              <>
                <p className="mt-2 text-[10px] font-medium text-ink-3">列入了却未出场</p>
                <ul className="mt-1 space-y-1 text-[11px] text-ink">
                  {castCard.missing.map((h) => (
                    <li key={h.name} className="break-all">
                      「{h.name}」在约定头里，本章正文未出现 TA 的署名或登记的别名
                      {h.aliases?.length ? `（${h.aliases.join('、')}）` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-ink-3">可能已删戏，或用了未登记的别称；不需要出场就移出清单。</p>
              </>
            )}
            <div className="mt-2 flex items-center gap-2">
              {castCard.unlisted.length > 0 && (
                <Button size="sm" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]" onClick={() => void addUnlisted()}>补入涉及人物</Button>
              )}
              {castCard.missing.length > 0 && (
                <Button size="sm" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]" onClick={() => void removeMissing()}>移出涉及人物</Button>
              )}
              <Button size="sm" variant="outline" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]" onClick={dismissCast}>忽略</Button>
            </div>
          </div>
        )}
      </main>

      <AgentPanel
        projectId={id}
        chapterRel={chapterRel || null}
        chapterTitle={cur?.name ?? ''}
        editorApi={() => apiRef.current}
        onChapterCheck={(tab) => {
          if (tab) setCheckTab(tab)
          setCheckOpen(true)
        }}
      />

      <ChapterCheckDrawer
        projectId={id}
        chapter={chapterRel || null}
        chapterTitle={cur?.name ?? ''}
        open={checkOpen}
        initialTab={checkTab}
        onClose={() => setCheckOpen(false)}
      />

      {/* 划词批注弹层（主人 2026-09-12） */}
      {/* 切章未保存守卫（2026-09-23 创作层）：dirty 时点其他章节 → 三选确认。
          数据安全 > 心流：与空写两步确认同属「拦截族」；只在真有未保存改动时弹（NN/g 确认过频成路障）。 */}
      <Dialog open={!!pendingSwitch} onOpenChange={(o) => !o && setPendingSwitch(null)}>
        <DialogContent className="sm:max-w-md" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>有未保存的改动</DialogTitle>
            <DialogDescription>当前章节有未保存的内容，切换后将丢失。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingSwitch(null)}>取消</Button>
            <Button variant="outline" onClick={discardSwitch} className="text-danger">不保存切换</Button>
            <Button onClick={() => void saveAndSwitch()}>保存并切换</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!annoTarget} onOpenChange={(o) => !o && setAnnoTarget(null)}>
        <DialogContent
          className="sm:max-w-md"
          outsideDismiss={false}
          onCloseAutoFocus={(e) => {
            // 划词「批注」入口在编辑器浮层（无 DialogTrigger）：Radix 关闭时找不到 trigger 会
            // preventDefault 原生焦点恢复，焦点落 body——显式还给编辑器（HIG：对话关闭后焦点回触发上下文）。
            e.preventDefault()
            apiRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>添加批注</DialogTitle>
            <DialogDescription>
              已选中：{annoTarget?.before.slice(0, 36)}
              {(annoTarget?.before.length ?? 0) > 36 ? '…' : ''}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={annoNote}
            onChange={(e) => setAnnoNote(e.target.value)}
            rows={4}
            autoFocus
            placeholder="写写这块要怎么改（批注优化会按它生成修改提案）"
            className="w-full"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAnnoTarget(null)}>
              取消
            </Button>
            <Button disabled={!annoNote.trim() || annoSaving} onClick={() => void saveAnno()}>
              {annoSaving ? '保存中…' : '保存批注'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>新建章节</DialogTitle>
            <DialogDescription>一章 = 一个时间切片。约定头会写进正文文件顶部，保存正文时按它做切片同步。</DialogDescription>
            {prefillChapter && (
              <p className="text-[11px] text-ink-3">
                已沿用{prefill.viaSel ? '当前选中章' : '上一章'}《{prefillChapter.fm?.['题名'] ?? prefillChapter.name}》的切片名、时间线与涉及人物，可直接修改。
              </p>
            )}
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>题名 *</Label>
              <Input autoFocus placeholder="如：夏夜的信" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={fieldEnter} />
            </div>
            <div className="space-y-1.5">
              <Label>时间切片名</Label>
              <Input placeholder="如：第二幕_台风夜（留空则用章号）" value={slice} onChange={(e) => setSlice(e.target.value)} onKeyDown={fieldEnter} />
            </div>
            <div className="space-y-1.5">
              <Label>时间线</Label>
              <Input
                data-testid="line-input"
                placeholder={`如：过去线（留空默认${DEFAULT_LINE}）`}
                value={timeLine}
                onChange={(e) => setTimeLine(e.target.value)}
                onKeyDown={fieldEnter}
              />
              {lineOpts.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="已有时间线">
                  {lineOpts.map((l, i) => (
                    <button
                      key={l.name}
                      type="button"
                      data-testid={`line-chip-${i}`}
                      onClick={() => setTimeLine(l.name)}
                      title={`${l.name}（${l.chapters} 章）`}
                      className={cn(
                        'inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                        timeLine === l.name
                          ? 'border-accent/50 bg-accent-soft text-accent'
                          : 'border-hair bg-surface text-ink-2 hover:bg-well hover:text-ink'
                      )}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>涉及人物（逗号分隔）</Label>
              <Input placeholder="如：林晚，顾知远" value={cast} onChange={(e) => setCast(e.target.value)} onKeyDown={fieldEnter} />
            </div>
            <div className="space-y-1.5">
              <Label>本章目标</Label>
              <Textarea rows={1} placeholder="主角在这一章要达成什么（可空，写了会更稳）" value={goal} onChange={(e) => setGoal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>核心冲突</Label>
              <Textarea rows={1} placeholder="本段主要矛盾，如：灯塔要正常值守，可守塔人想出海…" value={conflict} onChange={(e) => setConflict(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>关键事件（可多条）</Label>
              <Textarea rows={1} placeholder="每件一行：如&#10;· 有人来渡口打听旧船&#10;· 主角在行李里翻出一封信" value={plot} onChange={(e) => setPlot(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>前情呼应（可空）</Label>
              <Textarea rows={1} placeholder="要回应的伏笔 / 要用的设定：如：呼应幕一里的灯语约定" value={hook} onChange={(e) => setHook(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>取消</Button>
            <Button onClick={() => void createChapter()} disabled={!title.trim()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 章节重命名（§6.2）：改约定头题名 + 文件名；大纲副产物与版本历史随同改名 */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>重命名章节</DialogTitle>
            <DialogDescription>只改这一章的题名与文件名；大纲章卡/导演板等副产物和版本历史会随同改名。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>新题名 *</Label>
            <Input
              autoFocus
              value={renameVal}
              placeholder="新题名"
              aria-invalid={!!renameErr}
              className={fieldInvalidClass}
              onChange={(e) => {
                setRenameVal(e.target.value)
                if (renameErr) setRenameErr('')
              }}
              onKeyDown={(e) => {
                // IME 组合期 Enter 只确认候选，不重命名（F-IME-03）
                if (isImeComposing(e)) return
                if (e.key === 'Enter' && renameVal.trim()) void doRename()
              }}
            />
            {renameErr && <FieldError data-testid="rename-field-error">{renameErr}</FieldError>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>取消</Button>
            <Button onClick={() => void doRename()} disabled={!renameVal.trim()}>重命名</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 章节切片名修改（约定头字段编辑收口）：正文约定头 + 大纲副产物 fm 同步；旧切片提案置 stale；旧设定文件保留为历史 */}
      <Dialog open={!!sliceEditing} onOpenChange={(o) => !o && setSliceEditing(null)}>
        <DialogContent className="sm:max-w-md" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>修改切片名</DialogTitle>
            <DialogDescription>
              一章 = 一个时间切片。只改本章约定头的切片名；旧切片名下已落档的世界切片文件与人物状态小节保留为历史、不再参与后续同步与创作上下文，新切片名的设定由下次保存正文时重新同步。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>时间切片名 *</Label>
            <Input
              autoFocus
              value={sliceVal}
              placeholder="如：第二幕_台风夜"
              onChange={(e) => setSliceVal(e.target.value)}
              onKeyDown={(e) => {
                // IME 组合期 Enter 只确认候选，不改切片名（F-IME-03）
                if (isImeComposing(e)) return
                if (e.key === 'Enter' && sliceVal.trim()) void doEditSlice()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSliceEditing(null)}>取消</Button>
            <Button onClick={() => void doEditSlice()} disabled={!sliceVal.trim()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 章节删除确认：正文 + 同名大纲副产物移入系统废纸篓（可找回） */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除章节</DialogTitle>
            <DialogDescription>
              第{deleting?.fm?.['章号'] ?? '?'}章《{deleting?.fm?.['题名'] ?? deleting?.name ?? ''}》将连同所属大纲副产物一起移入系统废纸篓（可恢复）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button className="text-danger" onClick={() => void doDelete()}>移入废纸篓</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
