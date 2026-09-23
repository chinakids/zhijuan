import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import LoadingIndicator from '../../components/LoadingIndicator'
import Prose, { type ProseApi } from './Prose'
import HistoryDrawer from './HistoryDrawer'
import AnnoDrawer from './AnnoDrawer'
import { withBody } from '../../../../shared/fmatter'
import { countWords } from '../../../../shared/count'
import type { AnnotationRow } from '../../../../shared/annotations'
import type { SaveTraceEntry } from '../../../../shared/types'
import { registerDocEditor, unregisterDocEditor } from '../menu/menuState'
import { MENU_EV_SAVE, isMenuJustHandled } from '../menu/menuBus'
import { quoteSrcOf } from '../../lib/quoteSrc'

type DocStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'external' | 'error'

interface DocEditorProps {
  projectId: string
  /** 相对项目根的文件路径 */
  rel: string
  /** 外部想拿到本章编辑器的命令式入口（agent 引用/应用要用） */
  editorApiRef?: MutableRefObject<ProseApi | null>
  /** 外部想触发本章保存并获知结果（切章守卫「保存并切换」用；null=编辑器未就绪）。
   * doSave 返回 boolean：true=已写盘，false=被拦截/失败（未丢内容）。 */
  saveHandleRef?: MutableRefObject<(() => Promise<boolean>) | null>
  /** 章节类：只编辑约定头之下的正文，保存时保住约定头 */
  withFm?: boolean
  /** 外部文件版本号（父级监听的 fs 事件命中本文档时 +1）；未修改时触发静默重载 */
  extVersion?: number
  onDirty?: (dirty: boolean) => void
  onSave?: () => void
  className?: string
  /** 本章批注（仅章节正文页传入）：正文中被批注片段高亮 + 底部「批注 N」徽标跳转 */
  annotations?: AnnotationRow[]
  /** 批注入口（划词浮层/右键「写入批注」）可用性；批注管道只作用 `正文/**`，非正文语境传 false 隐藏（HIG：隐藏不可用项）。默认 true。 */
  anno?: boolean
  /** 底部状态条右侧追加内容（如规则体检状态栏；主人 2026-09-17：与「历史/未保存」同排，不单独占行） */
  statusExtra?: ReactNode
  /** 划词引用来源显示名覆盖（2026-09-24 体验层）：正文章节由 Novel 传「第N章 · 题名」
   * （与章列/窗口标题同格式，不暴露 `第NN章_题名.md` 文件结构名）；缺省按 rel 推「类别·名称」（quoteSrcOf）。 */
  quoteSrcLabel?: string
}

export default function DocEditor({ projectId, rel, withFm, extVersion, onDirty, onSave, className, editorApiRef, saveHandleRef, annotations, anno, statusExtra, quoteSrcLabel }: DocEditorProps) {
  const innerApi = useRef<ProseApi | null>(null)
  const apiRef = editorApiRef ?? innerApi
  const rawRef = useRef('') // 磁盘上的原文（含约定头）
  const savedMdRef = useRef('') // 最近一次保存时的正文
  const [status, setStatus] = useState<DocStatus>('idle')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [readErr, setReadErr] = useState('')
  /** 编辑器初始化（Milkdown create）失败：与 readErr 同口径显式呈现（P1 走查 2026-09-20 智能层） */
  const [initErr, setInitErr] = useState('')
  const [retryTick, setRetryTick] = useState(0) // 读取失败后「重试」：+1 触发加载 effect 重跑
  const [epoch, setEpoch] = useState(0) // 换文件时强制重建编辑器，避免脏状态串文件
  // P1 F-20260917-10 取证用：doSave 是 useCallback（deps 不含 epoch），闭包只能拿创建时旧值——
  // 保存动作留痕需要「保存时刻」的代次，经 ref 实时透传（仅取证，不参与行为）。
  const epochRef = useRef(epoch)
  epochRef.current = epoch
  const [historyOpen, setHistoryOpen] = useState(false)
  const [annoOpen, setAnnoOpen] = useState(false)
  // P1 防线「二次确认」（F-20260917-10，2026-09-19 创作层）：编辑器为空+磁盘非空被拦后，
  // 再按一次保存=作者显式确认真要清空（two-step confirmation；Confirmation 模式——
  // 不可逆写空动作需要两步验证，防 slip）。内容恢复/换文档即复位，防误放行。
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  // 本章实时字数：装载时按正文算一次，之后 onEdit（每次文档变化）更新。
  // 口径=shared/count.countWords（剥约定头与 markdown 标记；中文按字、连续西文按一词），
  // 与 HistoryDrawer「当前正文约 N 字」同源同义（2026-09-23 创作层，编辑器实时字数）。
  const [wordCount, setWordCount] = useState(0)
  // 批注被删空时自动收起抽屉（防空列表残留）
  const annoCount = annotations?.length ?? 0
  useEffect(() => {
    if (annoCount === 0) setAnnoOpen(false)
  }, [annoCount])

  // 加载文件；rel 变化就重来
  useEffect(() => {
    let cancel = false
    setLoading(true)
    setStatus('idle')
    setNote('')
    setReadErr('')
    setInitErr('')
    setEpoch((x) => x + 1)
    setConfirmEmpty(false) // 换文档/重试：清掉上文的「确要清空」待确认态
    ;(async () => {
      try {
        const raw = await window.zhijuan.readDoc(projectId, rel)
        if (cancel) return
        // 读取失败显式呈现（2026-09-19 智能层，P1 F-20260917-10 代码走查共 ②）：readDoc 不存在/不可读时
        // 返回 null，旧代码 `?? ''` 把它静默当空文档 → 编辑器显示空白（占位「开始写作…」），
        // 用户一保存就把磁盘整篇覆盖成空——正是下方注释警告的副作用，null 分支却漏了。
        // 与 states 体系（读取失败卡+重试，eac71e8）同口径：只有磁盘真空才显示空文档。
        if (raw === null) {
          setReadErr('读取文档失败：文件不存在或不可读')
          setLoading(false)
          return
        }
        rawRef.current = raw
        const body = withFm ? splitFm(raw).body : raw
        savedMdRef.current = body
        setWordCount(countWords(body))
        setLoading(false)
      } catch (e) {
        if (cancel) return
        // 读取失败必须显式呈现（不能静默当空文档：用户一保存就会把整篇覆盖成空文件）
        setReadErr(String((e as Error).message ?? e))
        setLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [projectId, rel, withFm, retryTick])

  const doSave = useCallback(async () => {
    const api = apiRef.current
    // P1 F-20260917-10 取证点（2026-09-19 创作层落地，仅取证不改行为）：每次保存动作在
    // `.zhijuan/save-trace.jsonl` 留一条渲染层侧证据（mdLen/status/epoch/confirmEmpty/action）——
    // 与主进程 write-log（写盘侧长度/内容头）互补；「保存时编辑器为何为空」下次再现可直接回放，
    // 不再需要靠 history 快照与引擎日志推断。fire-and-forget：不 await、失败无感。
    if (!api) {
      void window.zhijuan.saveTrace(projectId, rel, {
        time: Date.now(),
        mdLen: -1,
        status: statusRef.current,
        epoch: epochRef.current,
        confirmEmpty,
        diskBodyLen: -1,
        action: 'aborted'
      })
      return false
    }
    // P1 防线（F-20260917-10，2026-09-19 智能层）+ 创作层加固：编辑器内容为空但磁盘正文非空 → 拦一次，
    // 再按一次保存=两步确认放行（作者确要清空；空写不可逆，版本历史是唯一后悔药）。
    // 智能层原判据用内存 rawRef 判断磁盘——竞态下 rawRef 可能失真；本轮改为空 md 时真读磁盘（
    // 正常保存 md 非空零额外 IO），判定更可靠且不必信任内存快照。
    setStatus('saving')
    try {
      const md = api.getMarkdown()
      let diskBodyLen = -1
      let action: SaveTraceEntry['action'] = 'write'
      if (md === '') {
        const onDisk = (await window.zhijuan.readDoc(projectId, rel)) ?? ''
        diskBodyLen = withFm ? splitFm(onDisk).body.length : onDisk.length
        if (diskBodyLen > 0) {
          if (!confirmEmpty) {
            action = 'blocked'
            void window.zhijuan.saveTrace(projectId, rel, {
              time: Date.now(),
              mdLen: md.length,
              status: statusRef.current,
              epoch: epochRef.current,
              confirmEmpty,
              diskBodyLen,
              action
            })
            setStatus('external')
            setNote('正文疑似为空：磁盘上已有正文，本次未保存；若确要清空，请再按一次保存确认')
            setConfirmEmpty(true)
            return false
          }
          // 已确认（再按一次保存）：放行写空，随即复位防第三次误放行
          action = 'allow-empty'
          setConfirmEmpty(false)
        } else {
          // 磁盘也为空（首存/本就空文档）：正常写空，不算异常
          action = 'write-empty'
        }
      }
      const content = withFm ? withBody(rawRef.current, md) : md
      await window.zhijuan.writeDoc(projectId, rel, content)
      rawRef.current = content
      savedMdRef.current = md
      // 写盘成功留痕（blocked 已在上方分支记录，此处记录 write/allow-empty/write-empty）
      void window.zhijuan.saveTrace(projectId, rel, {
        time: Date.now(),
        mdLen: md.length,
        status: statusRef.current,
        epoch: epochRef.current,
        confirmEmpty,
        diskBodyLen,
        action
      })
      setStatus('saved')
      onSave?.()
      window.setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1800)
      return true
    } catch (e) {
      setStatus('error')
      setNote(String(e))
      return false
    }
  }, [projectId, rel, withFm, onSave, confirmEmpty])

  // 对外暴露「触发保存+结果」（切章守卫「保存并切换」用；只读 ref，不参与保存行为）
  useEffect(() => {
    if (!saveHandleRef) return
    saveHandleRef.current = doSave
    return () => {
      if (saveHandleRef) saveHandleRef.current = null
    }
  }, [doSave, saveHandleRef])

  // 编辑器挂载状态上报主进程菜单（save/find 组启用依据；正文与分幕草稿同构）
  useEffect(() => {
    registerDocEditor()
    return () => unregisterDocEditor()
  }, [])

  // 菜单「保存」→ 直接保存（菜单 accelerator 与 keydown 可能双达，防双触发见 isMenuJustHandled）
  const doSaveRef = useRef(doSave)
  doSaveRef.current = doSave
  useEffect(() => {
    const h = () => {
      if (apiRef.current) void doSaveRef.current()
    }
    window.addEventListener(MENU_EV_SAVE, h)
    return () => window.removeEventListener(MENU_EV_SAVE, h)
  }, [])

  // Cmd/Ctrl+S
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        // 菜单 accelerator 刚处理过（时间窗内）→ 跳过，避免双保存（口径 §五-1）
        if (isMenuJustHandled('save')) return
        e.preventDefault()
        if (apiRef.current) void doSave()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [doSave])

  // 调试：无头测试时把内部态挂到 window 便于取证
  if ((window as unknown as { __ZJ_TEST?: boolean }).__ZJ_TEST) {
    ;(window as unknown as { __ZJ_DOC?: { rel: string; savedMd: string; loading: boolean } }).__ZJ_DOC = { rel, savedMd: savedMdRef.current, loading }
  }

  // 外部文件有更新：本页无未保存改动 → 静默重载（以磁盘最新内容整篇灌回），已修改 → 提示
  // 注：判定用 status==='dirty'（Prose 编辑态），不能与 savedMdRef 做字符串比较——
  //     savedMdRef 初始是磁盘原文，而 getMarkdown() 是 Milkdown 序列化结果，两者格式永不等，
  //     曾因此导致「恢复后」永远误报磁盘冲突、静默重载从不命中（2026-09-10 无头冒烟暴露）。
  const statusRef = useRef(status)
  statusRef.current = status
  useEffect(() => {
    if (extVersion === undefined || extVersion === 0) return
    if (statusRef.current === 'dirty') {
      setStatus('external')
      setNote('磁盘有更新且本页有未保存改动 — 请重新保存或另存')
      return
    }
    let cancelled = false
    void (async () => {
      let raw: string | null
      try {
        raw = await window.zhijuan.readDoc(projectId, rel)
      } catch {
        // 2026-09-19 智能层（P1 代码走查共 ④）：重载读失败同样跳过（原代码无 catch=未处理拒绝，
        // 且与 null 同型风险——不让「读不到」变「空的」）；保留当前内容等待下一次事件。
        return
      }
      if (cancelled) return
      // 2026-09-19 智能层（P1 代码走查共 ③）：外部读回 null（文件被删/暂不可读）时**跳过重载**——
      // 旧代码 `?? ''` 会把编辑器静默替换成空白（extVersion 重载竞态 → 空正文假象，
      // F-20260917-10 疑点②「保存→清空」形态的候选机理之一）；宁可保留当前内容等待
      // 下一次事件，也不把「读不到」渲染成「文档是空的」。
      if (raw === null) return
      // await 期间编辑器可能已随换文件重建（epoch 驱动）：旧实例已被 destroy，
      // 若继续用 effect 开头捕获的旧 api 会抛 MilkdownError contextNotFound（2026-09-16 修，
      // 建章/切章后 console 报 headingAttr 错误即此）。重读 apiRef 且重查 dirty
      // （await 期间用户可能已开始编辑，不覆盖用户输入）。
      const api = apiRef.current
      if (!api || statusRef.current === 'dirty') return
      rawRef.current = raw
      const body = withFm ? splitFm(raw).body : raw
      savedMdRef.current = body
      api.setContent(body)
      // 已保存状态保留（1.8s 定时器自清）：真实链路 fs 事件会随本次保存回灌 extVersion，
      // 若把 saved 立刻置 idle，用户看不到「✓ 已保存」确认（HIG 状态反馈即时、无歧义）。
      setStatus((s) => (s === 'saved' ? s : 'idle'))
      setNote('')
    })()
    return () => {
      cancelled = true
    }
  }, [extVersion, projectId, rel, withFm])

  const dirty = status === 'dirty'
  useEffect(() => onDirty?.(dirty), [dirty, onDirty])

  if (loading) {
    return (
      <div className={cn('flex h-full items-center justify-center gap-2 text-sm text-ink-3', className)}>
        <LoadingIndicator size={16} />
        <span>正在读取文档…</span>
      </div>
    )
  }
  if (initErr) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm', className)}>
        <p className="text-danger">编辑器初始化失败</p>
        <p className="max-w-md break-all text-center text-xs text-ink-3">{initErr}</p>
        <button
          className="text-xs text-accent underline-offset-2 hover:underline"
          onClick={() => setRetryTick((x) => x + 1)}
        >
          重试
        </button>
      </div>
    )
  }
  if (readErr) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm', className)}>
        <p className="text-danger">读取文档失败</p>
        <p className="max-w-md break-all text-center text-xs text-ink-3">{readErr}</p>
        <button
          className="text-xs text-accent underline-offset-2 hover:underline"
          onClick={() => setRetryTick((x) => x + 1)}
        >
          重试
        </button>
      </div>
    )
  }

  const stLabel: Record<DocStatus, { text: string; cls: string }> = {
    idle: { text: '', cls: '' },
    dirty: { text: '● 未保存', cls: 'text-warn' },
    saving: { text: '保存中…', cls: 'text-ink-3' },
    saved: { text: '✓ 已保存', cls: 'text-success' },
    external: { text: note, cls: 'text-danger' },
    error: { text: '保存失败：' + note, cls: 'text-danger' }
  }
  const st = stLabel[status]
  const busy = status === 'saving'
  // 保存钮可用性（2026-09-20 体验层 HIG 走查修）：dirty/外部冲突/失败/待确认清空 都需要「保存」
  // 动作可用——旧判据 !dirty 会在拦截提示「再按一次保存确认」与失败重试时把按钮禁掉（只剩 ⌘S 能走，
  // 鼠标唯一入口失效）；saved/idle 保持禁用（无内容可存，防无谓写盘）。
  const canSave = status === 'dirty' || status === 'external' || status === 'error' || confirmEmpty

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex min-h-0 flex-1 overflow-auto">
        <Prose
          key={epoch}
          apiRef={apiRef}
          value={savedMdRef.current}
          onCreateError={(msg) => setInitErr(msg)}
          onEdit={(md) => {
            // 内容恢复非空：清掉「确要清空」待确认态（之后再次清空仍会被拦一次，防误放行）
            if (md) setConfirmEmpty(false)
            setWordCount(countWords(md))
            // 内容与已保存一致时：saved 保留（外部重载会经 markdownUpdated 进这里，别把
            // 「✓ 已保存」确认擦成 idle，HIG 即时反馈）；否则回到 dirty
            setStatus((prev) => {
              if (md === savedMdRef.current) return prev === 'saved' ? prev : 'idle'
              return 'dirty'
            })
          }}
          className="h-full w-full"
          annotations={annotations}
          anno={anno}
          memoryKey={`${projectId}:${rel}`}
          quoteSrc={quoteSrcLabel ?? quoteSrcOf(rel)}
        />
      </div>
      <div className="flex h-7 items-center gap-2 border-t border-hair px-4 text-xs">
        <button onClick={() => setHistoryOpen(true)} className="shrink-0 whitespace-nowrap text-xs text-ink-2 underline-offset-2 hover:underline" title="正文自动留档的版本历史（查看差异 / 恢复）">历史</button>
        {(annotations?.length ?? 0) > 0 && (
          <button
            onClick={() => setAnnoOpen(true)}
            className="shrink-0 whitespace-nowrap text-xs text-warn underline-offset-2 hover:underline"
            title={`正文有 ${annotations!.length} 条批注，点击展开列表定位到对应高亮`}
          >
            批注 {annotations!.length}
          </button>
        )}
        <span
          role="status"
          className={cn('inline-flex min-w-0 items-center gap-1 font-medium', st.cls)}
          title={st.text || undefined}
        >
          {status === 'saving' && <LoadingIndicator size={12} />}
          <span className="truncate">{st.text}</span>
        </span>
        {!loading && !readErr && (
          <span
            className="shrink-0 whitespace-nowrap text-ink-2"
            title="本章字数（中文按字、连续西文按一词；不含约定头与标记）"
          >
            约 {wordCount} 字
          </span>
        )}
        <span className="flex-1" />
        {statusExtra}
        <button
          onClick={() => void doSave()}
          disabled={busy || !canSave}
          title={confirmEmpty ? '正文为空但磁盘上已有正文：再次保存将确认清空（⌘S 同）' : '保存正文（⌘S）'}
          className="shrink-0 whitespace-nowrap text-xs text-ink-2 underline-offset-2 hover:underline disabled:opacity-40"
        >
          保存 ⌘S
        </button>
      </div>
      <HistoryDrawer projectId={projectId} rel={rel} open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <AnnoDrawer
        annotations={annotations ?? []}
        open={annoOpen}
        onClose={() => setAnnoOpen(false)}
        jump={(row) => apiRef.current?.jumpToAnnotation(0, row)}
        onHoverRow={(row) => apiRef.current?.setAnnoActive(row)}
      />
    </div>
  )
}

function splitFm(raw: string): { body: string } {
  const i = raw.indexOf('---\n')
  if (i !== 0) return { body: raw }
  const j = raw.indexOf('\n---', 4)
  if (j < 0) return { body: raw }
  return { body: raw.slice(j + 4) }
}
