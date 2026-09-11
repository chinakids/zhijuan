import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ClipboardCopy, Loader2, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react'
import type { ChapterCheckItem, ChapterCheckKind, ChapterCheckResult, RevisionLayer } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { toast } from '../../components/ui/toast'

const TYPE_TXT: Record<string, string> = {
  'setting-conflict': '设定冲突', timeline: '时间线', foreshadow: '伏笔', 'character-drift': '人物漂移',
  structure: '结构', pacing: '节奏', character: '人物', prose: '行文'
}
const LAYER_TXT: Record<RevisionLayer, string> = { story: '故事层', scene: '场景层', prose: '词句层' }
const SEV_CN: Record<ChapterCheckItem['severity'], string> = {
  high: 'bg-danger text-white',
  medium: 'bg-warn text-white',
  low: 'bg-ink-3 text-white'
}
const LAYER_CLS: Record<RevisionLayer, string> = {
  story: 'bg-danger-soft text-danger',
  scene: 'bg-accent-soft text-accent',
  prose: 'bg-ink-2 text-white'
}

interface Props {
  projectId: string
  /** 当前打开的章节文件（正文/…）；为空时整抽屉只展示提示 */
  chapter: string | null
  chapterTitle: string
  open: boolean
  /** 打开时默认 tab（短巡查/分层修订）；仅在被显式请求变更（如 /巡查 修订）时生效，不覆盖用户手选 */
  initialTab?: ChapterCheckKind
  onClose: () => void
}

/** 本章级小环：每章短巡查（chapter）/ 分层修订（revision）。工作在写作半径内的当前章，参数比全卷检查轻。 */
export default function ChapterCheckDrawer({ projectId, chapter, chapterTitle, open, onClose, initialTab }: Props) {
  const [tab, setTab] = useState<ChapterCheckKind>(initialTab ?? 'chapter')
  const lastReq = useRef<ChapterCheckKind>(initialTab ?? 'chapter')
  // 显式请求（如命令行 /巡查 修订）才切换默认 tab；用户手选不被打断
  useEffect(() => {
    if (!open) return
    if (initialTab && initialTab !== lastReq.current) {
      lastReq.current = initialTab
      setTab(initialTab)
    }
  }, [open, initialTab])
  const [res, setRes] = useState<Partial<Record<ChapterCheckKind, ChapterCheckResult>>>({})
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const [made, setMade] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)

  // 抽屉是否在看的实时镜像：跑检查时用户可能关掉抽屉（组件不卸载、state 保留），
  // 完成后若抽屉已不在看，把结果要点用全局 toast 带到外面（HIG：当前视图已呈现则前台不通知）。
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const run = useCallback(async () => {
    if (!chapter) return
    setRunning(true)
    setErr('')
    try {
      const r = await window.zhijuan.agentChapterCheck(projectId, chapter, tab)
      if (r.ok) {
        setRes((m) => ({ ...m, [tab]: r.result }))
        if (!openRef.current) {
          const n = r.result.items.length
          if (n > 0)
            toast.add({ kind: 'warning', title: `本章小环发现 ${n} 条`, description: '结果已保留，重开「本章小环」抽屉可查看' })
        }
      } else {
        setErr(r.error ?? '本章检查失败')
        if (!openRef.current) toast.add({ kind: 'error', title: '本章检查失败', description: r.error ?? '未知原因' })
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      setErr(msg)
      if (!openRef.current) toast.add({ kind: 'error', title: '本章检查失败', description: msg })
    } finally {
      setRunning(false)
    }
  }, [projectId, chapter, tab])

  useEffect(() => {
    if (!open || !chapter) return
    if (running || res[tab] || err) return
    void run()
  }, [open, chapter, tab, res, running, err, run])

  const idKey = (kind: ChapterCheckKind, i: number) => kind + ':' + i

  const makeProposal = async (kind: ChapterCheckKind, i: number, it: ChapterCheckItem) => {
    if (!it.target) return
    try {
      await window.zhijuan.createProposals(projectId, 'agent-chat', chapter ?? '', '', [
        { target: it.target, anchor: '', kind: 'append', before: '', after: it.suggest + '\n\n> 依据：' + it.what, reason: (kind === 'chapter' ? '本章快速巡查' : '分层修订') + ' · ' + (TYPE_TXT[it.type] ?? it.type) }
      ])
      setMade((s) => new Set(s).add(idKey(kind, i)))
    } catch {
      /* 忽略单个失败 */
    }
  }

  const copySuggestion = async (k: string, it: ChapterCheckItem) => {
    try {
      await navigator.clipboard.writeText(`【织卷修订】位置：${it.where}\n问题：${it.what}\n改法：${it.suggest}`)
      setCopied(k)
      window.setTimeout(() => setCopied((c) => (c === k ? null : c)), 1800)
    } catch {
      /* 忽略 */
    }
  }

  if (!open) return null

  const cur = res[tab]
  const orderedLayers: RevisionLayer[] = ['story', 'scene', 'prose']

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/10" onClick={onClose}>
      <div className="flex h-full w-[460px] max-w-[94vw] flex-col border-l border-hair bg-surface shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
          <ShieldAlert className="h-4 w-4 text-accent" />
          <span className="truncate text-sm font-semibold">本章小环 · {chapterTitle || '未打开章节'}</span>
          <span className="flex-1" />
          <button
            onClick={() => setTab('chapter')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'chapter' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            短巡查
          </button>
          <button
            onClick={() => setTab('revision')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'revision' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            分层修订
          </button>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!chapter ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-ink-3">
            先在左边选中一个章节，再来看它的快查与修订单。小环是沿写作线的兜底：写完一段随时点一下。
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-hair px-4 py-2 text-[11px] text-ink-3">
              {tab === 'chapter' ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <ClipboardCopy className="h-3.5 w-3.5" />
              )}
              {running || !cur ? (
                !err ? (
                  <span className="flex items-center gap-1 text-accent"><Loader2 className="h-3 w-3 animate-spin" /> 写作引擎读本章…（一两分钟）</span>
                ) : (
                  <span className="text-danger">{err}</span>
                )
              ) : (
                <span>
                  {tab === 'chapter'
                    ? `本章共列 ${cur!.items.length} 条，可逐条转提案。`
                    : `按故事 → 场景 → 词句共 ${cur!.items.length} 条建议；可直接复制改法回正文。`}
                </span>
              )}
              <span className="flex-1" />
              {cur && !running && (
                <button
                  onClick={() => {
                    setRes((m) => ({ ...m, [tab]: undefined }))
                    setErr('')
                    void run()
                  }}
                  className="flex items-center gap-1 text-ink-3 hover:text-ink"
                >
                  <RefreshCw className="h-3 w-3" /> 重跑
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!err && cur && cur.summary && (
                <p className="mb-3 rounded-lg border border-hair bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">{cur.summary}</p>
              )}
              {!err && cur && cur.items.length === 0 && (
                <p className="py-10 text-center text-xs text-ink-3">
                  <Sparkles className="mx-auto mb-2 h-6 w-6" /> 这一遍没有发现问题。
                </p>
              )}

              {tab === 'revision' &&
                [
                  ...orderedLayers.map((lv) => ({ key: lv, rows: cur?.items.filter((x) => x.layer === lv) ?? [] })),
                  { key: 'none', rows: cur?.items.filter((x) => !x.layer) ?? [] }
                ].map((g) => {
                  if (!g.rows.length) return null
                  const valKw: Record<string, string> = {
                    story: LAYER_TXT.story,
                    scene: LAYER_TXT.scene,
                    prose: LAYER_TXT.prose,
                    none: '未分层'
                  }
                  const clsFor: Record<string, string> = {
                    story: LAYER_CLS.story,
                    scene: LAYER_CLS.scene,
                    prose: LAYER_CLS.prose,
                    none: 'bg-warn-soft text-warn'
                  }
                  return (
                    <div key={g.key as string} className="mb-3">
                      <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-medium">
                        <span className={cn('rounded px-1.5 py-0.5', clsFor[g.key as string])}>{valKw[g.key as string]}</span>
                        <span className="text-ink-3">{g.rows.length} 条</span>
                      </p>
                      {g.rows.map((it, i) => {
                        const gi = cur!.items.indexOf(it)
                        const k = idKey('revision', gi)
                        return row(it, k, 'revision', gi)
                      })}
                    </div>
                  )
                })}

              {tab === 'chapter' && cur?.items.map((it, i) => row(it, idKey('chapter', i), 'chapter', i))}
            </div>
          </>
        )}
      </div>
    </div>
  )

  function row(it: ChapterCheckItem, k: string, kind: ChapterCheckKind, gi: number) {
    return (
      <div key={k} className="mb-2 rounded-lg border border-hair bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', SEV_CN[it.severity])}>{it.severity}</span>
          <span className="text-[11px] font-medium text-accent">{TYPE_TXT[it.type] ?? it.type}</span>
          <span className="flex-1" />
          {it.target &&
            (made.has(k) ? (
              <span className="flex items-center gap-1 text-[11px] text-success"><Check className="h-3 w-3" /> 已建提案</span>
            ) : (
              <button
                onClick={() => void makeProposal(kind, gi, it)}
                className="flex items-center gap-1 rounded-md border border-hair px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
              >
                <AlertTriangle className="h-3 w-3" /> 转提案
              </button>
            ))}
          {kind === 'revision' &&
            (copied === k ? (
              <span className="flex items-center gap-1 text-[11px] text-success"><Check className="h-3 w-3" /> 已复制</span>
            ) : (
              <button
                onClick={() => void copySuggestion(k, it)}
                className="flex items-center gap-1 rounded-md border border-hair px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
              >
                <ClipboardCopy className="h-3 w-3" /> 复制改法
              </button>
            ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-3">{it.where}</p>
        <p className="mt-1 text-xs text-ink">{it.what}</p>
        <p className="mt-1 text-[11px] text-ink-2">建议：{it.suggest}</p>
      </div>
    )
  }
}
