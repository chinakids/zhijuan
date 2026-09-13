import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { cn } from '../../lib/utils'
import LoadingIndicator from '../../components/LoadingIndicator'
import Prose, { type ProseApi } from './Prose'
import HistoryDrawer from './HistoryDrawer'
import AnnoDrawer from './AnnoDrawer'
import { withBody } from '../../../../shared/fmatter'
import type { AnnotationRow } from '../../../../shared/annotations'
import { registerDocEditor, unregisterDocEditor } from '../menu/menuState'
import { MENU_EV_SAVE, isMenuJustHandled } from '../menu/menuBus'

type DocStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'external' | 'error'

interface DocEditorProps {
  projectId: string
  /** 相对项目根的文件路径 */
  rel: string
  /** 外部想拿到本章编辑器的命令式入口（agent 引用/应用要用） */
  editorApiRef?: MutableRefObject<ProseApi | null>
  /** 章节类：只编辑约定头之下的正文，保存时保住约定头 */
  withFm?: boolean
  /** 外部文件版本号（父级监听的 fs 事件命中本文档时 +1）；未修改时触发静默重载 */
  extVersion?: number
  onDirty?: (dirty: boolean) => void
  onSave?: () => void
  className?: string
  /** 本章批注（仅章节正文页传入）：正文中被批注片段高亮 + 底部「批注 N」徽标跳转 */
  annotations?: AnnotationRow[]
}

export default function DocEditor({ projectId, rel, withFm, extVersion, onDirty, onSave, className, editorApiRef, annotations }: DocEditorProps) {
  const innerApi = useRef<ProseApi | null>(null)
  const apiRef = editorApiRef ?? innerApi
  const rawRef = useRef('') // 磁盘上的原文（含约定头）
  const savedMdRef = useRef('') // 最近一次保存时的正文
  const [status, setStatus] = useState<DocStatus>('idle')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [readErr, setReadErr] = useState('')
  const [retryTick, setRetryTick] = useState(0) // 读取失败后「重试」：+1 触发加载 effect 重跑
  const [epoch, setEpoch] = useState(0) // 换文件时强制重建编辑器，避免脏状态串文件
  const [historyOpen, setHistoryOpen] = useState(false)
  const [annoOpen, setAnnoOpen] = useState(false)
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
    setEpoch((x) => x + 1)
    ;(async () => {
      try {
        const raw = (await window.zhijuan.readDoc(projectId, rel)) ?? ''
        if (cancel) return
        rawRef.current = raw
        const body = withFm ? splitFm(raw).body : raw
        savedMdRef.current = body
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
    if (!api) return
    setStatus('saving')
    try {
      const md = api.getMarkdown()
      const content = withFm ? withBody(rawRef.current, md) : md
      await window.zhijuan.writeDoc(projectId, rel, content)
      rawRef.current = content
      savedMdRef.current = md
      setStatus('saved')
      onSave?.()
      window.setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1800)
    } catch (e) {
      setStatus('error')
      setNote(String(e))
    }
  }, [projectId, rel, withFm, onSave])

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
    const api = apiRef.current
    if (!api) return
    if (statusRef.current === 'dirty') {
      setStatus('external')
      setNote('磁盘有更新且本页有未保存改动 — 请重新保存或另存')
      return
    }
    void (async () => {
      const raw = (await window.zhijuan.readDoc(projectId, rel)) ?? ''
      rawRef.current = raw
      const body = withFm ? splitFm(raw).body : raw
      savedMdRef.current = body
      api.setContent(body)
      setStatus('idle')
      setNote('')
    })()
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

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex min-h-0 flex-1 overflow-auto">
        <Prose
          key={epoch}
          apiRef={apiRef}
          value={savedMdRef.current}
          onEdit={(md) => setStatus(md === savedMdRef.current ? 'idle' : 'dirty')}
          className="h-full w-full"
          annotations={annotations}
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
        <span className={cn('font-medium', st.cls)}>{st.text}</span>
        <span className="flex-1" />
        <button onClick={() => void doSave()} disabled={!dirty || busy} className="text-xs text-ink-2 underline-offset-2 hover:underline disabled:opacity-40">保存 ⌘S</button>
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
