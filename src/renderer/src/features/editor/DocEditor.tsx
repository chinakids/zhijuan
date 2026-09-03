import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import Prose, { type ProseApi } from './Prose'
import { withBody } from '../../../../shared/fmatter'

type DocStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'external' | 'error'

interface DocEditorProps {
  projectId: string
  /** 相对项目根的文件路径 */
  rel: string
  /** 章节类：只编辑约定头之下的正文，保存时保住约定头 */
  withFm?: boolean
  /** 外部文件版本号（父级监听的 fs 事件命中本文档时 +1）；未修改时触发静默重载 */
  extVersion?: number
  onDirty?: (dirty: boolean) => void
  onSave?: () => void
  className?: string
}

export default function DocEditor({ projectId, rel, withFm, extVersion, onDirty, onSave, className }: DocEditorProps) {
  const apiRef = useRef<ProseApi | null>(null)
  const rawRef = useRef('') // 磁盘上的原文（含约定头）
  const savedMdRef = useRef('') // 最近一次保存时的正文
  const [status, setStatus] = useState<DocStatus>('idle')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [epoch, setEpoch] = useState(0) // 换文件时强制重建编辑器，避免脏状态串文件

  // 加载文件；rel 变化就重来
  useEffect(() => {
    let cancel = false
    setLoading(true)
    setStatus('idle')
    setNote('')
    setEpoch((x) => x + 1)
    ;(async () => {
      const raw = (await window.zhijuan.readDoc(projectId, rel)) ?? ''
      if (cancel) return
      rawRef.current = raw
      const body = withFm ? splitFm(raw).body : raw
      savedMdRef.current = body
      setLoading(false)
    })()
    return () => {
      cancel = true
    }
  }, [projectId, rel, withFm])

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

  // Cmd/Ctrl+S
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
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

  // 外部文件有更新：未修改则静默重载，已修改则提示
  useEffect(() => {
    if (extVersion === undefined || extVersion === 0) return
    const api = apiRef.current
    if (!api) return
    const now = api.getMarkdown()
    if (now === savedMdRef.current) {
      void (async () => {
        const raw = (await window.zhijuan.readDoc(projectId, rel)) ?? ''
        rawRef.current = raw
        const body = withFm ? splitFm(raw).body : raw
        savedMdRef.current = body
        api.setContent(body)
        setStatus('idle')
        setNote('')
      })()
    } else {
      setStatus('external')
      setNote('磁盘有更新且本页有未保存改动 — 请重新保存或另存')
    }
  }, [extVersion, projectId, rel, withFm])

  const dirty = status === 'dirty'
  useEffect(() => onDirty?.(dirty), [dirty, onDirty])

  if (loading) {
    return <div className={cn('flex h-full items-center justify-center text-sm text-ink-3', className)}>正在读取文档…</div>
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
          className="mx-auto h-full w-full max-w-3xl px-6 py-5"
        />
      </div>
      <div className="flex h-7 items-center gap-2 border-t border-hair px-4 text-xs">
        <span className={cn('font-medium', st.cls)}>{st.text}</span>
        <span className="flex-1" />
        <button onClick={() => void doSave()} disabled={!dirty || busy} className="text-xs text-ink-2 underline-offset-2 hover:underline disabled:opacity-40">保存 ⌘S</button>
      </div>
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
