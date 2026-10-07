import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CloudDownload, Eye, RefreshCw, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { cn } from '../../lib/utils'
import { useFsChanged } from '../fs/useFsEvents'
import { toast } from '../../store/toasts'
import { isImeComposing } from '../../lib/ime'
import { isLibraryResultPath, isTaskStale, parseTaskCard, rebuildTaskCardForRetry, taskCardDoc, taskCardFileName } from '../../../../shared/taskCard'

/* ===== 织卷 S5 · 采集栏：任务卡列表 + 发起采集表单 ===== */

type TaskStatus = 'pending' | 'done' | 'failed' | 'running'
interface TaskInfo {
  file: string
  mtime: number
  status: TaskStatus
  summary: string
  demand: string
  stale: boolean
}

const STATUS_CLS: Record<string, string> = {
  pending: 'bg-warn-soft text-warn',
  running: 'bg-accent-soft text-accent',
  done: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-danger'
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-12 shrink-0 text-ink-3">{k}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink-2">{v}</dd>
    </div>
  )
}

/** 与管道/详情共用的四值清洗：未知状态（管道将来可能扩展）一律按 pending 展示 */
function normalizeStatus(v: string): TaskStatus {
  return (['pending', 'done', 'failed', 'running'] as const).includes(v as TaskStatus) ? (v as TaskStatus) : 'pending'
}

/** 停滞天数（≥1）：列表/详情提示用 */
function staleDays(mtimeMs: number, nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - mtimeMs) / 86_400_000))
}

/** 需求文本归一（查重用）：去首尾空白与内部空白，避免「校园 图书馆」与「校园图书馆」被判不同 */
const normDemand = (s: string): string => s.trim().replace(/\s+/g, '')

/** 刷新失败 toast 节流（模块级，跨渲染保持）：5s 内不重复弹 */
let lastRefreshErrAt = 0

export default function CollectionBar({ requestOpen = 0 }: { requestOpen?: number }) {
  const { id = '' } = useParams()
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [open, setOpen] = useState(false)
  const [demand, setDemand] = useState('')
  const [keywords, setKeywords] = useState('')
  const [category, setCategory] = useState('环境')
  const [source, setSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<TaskInfo | null>(null)
  const [viewText, setViewText] = useState('')
  // 详情内「结果」素材预览（只读）：rel=素材路径，text=读到的内容（null=文件不存在）
  const [preview, setPreview] = useState<{ rel: string; text: string | null } | null>(null)
  // 删除确认：confirmDelete 非空时打开确认框（详情先关闭，避免嵌套 Dialog 焦点问题）
  const [confirmDelete, setConfirmDelete] = useState<TaskInfo | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 刷新失败：toast 节流（5s 内不重复弹），失败时保留旧列表（不闪空）
  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const list = await window.zhijuan.listDocs(id, '素材库/采集池')
      const nowMs = Date.now()
      const infos: TaskInfo[] = []
      for (const d of list) {
        // listDocs 返回相对 relDir 的路径，需拼回「素材库/采集池/」前缀（否则 readDoc 读到项目根同名文件/空）
        let text = ''
        try {
          text = (await window.zhijuan.readDoc(id, '素材库/采集池/' + d.file)) ?? ''
        } catch {
          // 单卡读失败：跳过该卡（保留其余）；真机 readDoc 对不可读返回 null（静默语义），reject 仅防御
          continue
        }
        const v = parseTaskCard(text)
        const s = text.match(/^#\s*(.+)$/m)
        infos.push({
          file: d.file,
          mtime: d.mtime,
          status: normalizeStatus(v.status),
          summary: s ? s[1].slice(0, 40) : d.file.replace(/\.md$/, ''),
          demand: v.demand,
          stale: isTaskStale(v.status, d.mtime, nowMs)
        })
      }
      setTasks(infos)
    } catch (e) {
      const now = Date.now()
      if (now - lastRefreshErrAt > 5000) {
        lastRefreshErrAt = now
        toast.add({ kind: 'error', title: '刷新采集任务失败', description: String((e as Error).message ?? e).slice(0, 120) })
      }
    }
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 侧栏「发起采集」快捷入口：外部请求打开表单（tick 递增防同值被 React 忽略）；
  // Library 页消费 ?collect=1 后清参，这里只负责弹起，不重复弹。
  useEffect(() => {
    if (requestOpen > 0) setOpen(true)
  }, [requestOpen])

  // 管道回填 = 任务卡+素材连续写盘；useFsChanged 检查批内全部新事件（含被末条「顶掉」的采集池事件），
  // 且不重复触发已消费事件（旧实现 .some 会在 50 窗口内重扫，非匹配事件也会连带多刷）。
  useFsChanged(id, '素材库/采集池', () => void refresh())

  async function openView(t: TaskInfo) {
    setView(t)
    setPreview(null)
    try {
      setViewText((await window.zhijuan.readDoc(id, '素材库/采集池/' + t.file)) ?? '')
    } catch (e) {
      setView(null)
      toast.add({ kind: 'error', title: '预览读取失败', description: String((e as Error).message ?? e).slice(0, 120) })
    }
  }

  /** 结果行点击：读素材文件 → 详情内只读预览；已展开则收起 */
  async function togglePreview(rel: string) {
    if (preview?.rel === rel) {
      setPreview(null)
      return
    }
    try {
      const text = (await window.zhijuan.readDoc(id, rel)) ?? null
      setPreview({ rel, text })
    } catch (e) {
      setPreview(null)
      toast.add({ kind: 'error', title: '预览读取失败', description: String((e as Error).message ?? e).slice(0, 120) })
    }
  }

  async function submit() {
    if (!id || !demand.trim() || saving) return
    setSaving(true)
    try {
      const ts = Date.now()
      const name = taskCardFileName(ts)
      const kws = keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      const fm = taskCardDoc({ demand, keywords: kws, category: category.trim(), source: source.trim(), ts })
      await window.zhijuan.writeDoc(id, '素材库/采集池/' + name + '.md', fm)
      setOpen(false)
      setDemand(''); setKeywords(''); setCategory('环境'); setSource('')
      await refresh()
    } catch (e) {
      // 写入失败：弹窗与已填内容保留（可就地重试），按钮态复位
      toast.add({ kind: 'error', title: '提交任务失败', description: String((e as Error).message ?? e).slice(0, 120) })
    } finally {
      setSaving(false)
    }
  }

  /** 删除任务卡：走 doc:delete（进系统废纸篓可恢复），完成后关详情回列表（fs 事件也会触发刷新） */
  async function doDelete(t: TaskInfo) {
    setDeleting(true)
    try {
      const r = await window.zhijuan.deleteDoc(id, '素材库/采集池/' + t.file)
      if (!r.ok) throw new Error(r.error || '删除失败')
      setConfirmDelete(null)
      setView(null)
      setPreview(null)
      await refresh()
    } catch (e) {
      // 删除失败：确认框保留（可重试/取消），按钮态复位
      toast.add({ kind: 'error', title: '删除任务失败', description: String((e as Error).message ?? e).slice(0, 120) })
    } finally {
      setDeleting(false)
    }
  }

  /** 重发：按现卡字段重建为全新 pending 卡（清结果/完成，mtime 随写盘更新）——管道会重新处理 */
  async function doRetry(t: TaskInfo) {
    if (!t) return
    try {
      const text = (await window.zhijuan.readDoc(id, '素材库/采集池/' + t.file)) ?? ''
      const next = rebuildTaskCardForRetry(parseTaskCard(text))
      await window.zhijuan.writeDoc(id, '素材库/采集池/' + t.file, next)
      setView(null)
      setPreview(null)
      await refresh()
    } catch (e) {
      // 重发失败：详情保留（可就地重试）
      toast.add({ kind: 'error', title: '重发任务失败', description: String((e as Error).message ?? e).slice(0, 120) })
    }
  }

  /** 发起采集表单：单行字段 Enter=提交（HIG Buttons「primary button responds to the Return key」；IME 组合期 Enter 只确认候选不提交；多行 Textarea 保持换行语义不接） */
  const fieldSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="shrink-0 border-b border-hair bg-surface-2 px-4 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <CloudDownload className="h-4 w-4 text-accent" />
        <span className="text-xs font-medium text-ink">采集任务（本机管道按需求抓取）</span>
        <span className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px] [&_svg]:size-3" onClick={() => void refresh()}>
          <RefreshCw className="mr-1" /> 刷新
        </Button>
        <Button size="sm" className="h-7 px-2.5 text-[11px]" onClick={() => setOpen(true)}>＋ 发起采集</Button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-[11px] text-ink-3">还没有采集任务。点击「发起采集」，任务会落到 素材库/采集池，由本机管道处理。</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tasks.map((t) => (
            <button
              key={t.file}
              onClick={() => void openView(t)}
              title="点击查看任务卡详情（回填的结果在此）"
              className="flex items-center gap-2 rounded-lg border border-hair bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-accent/60 hover:bg-surface-2"
            >
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', STATUS_CLS[t.status])}>{t.status}</span>
              {t.stale && (
                <span
                  title={`已 ${staleDays(t.mtime, Date.now())} 天未被本机管道触碰（可能停机/失败/被跳过），确认后可在详情里删除重发起`}
                  className="rounded-full border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn"
                >
                  停滞 {staleDays(t.mtime, Date.now())} 天
                </span>
              )}
              <span className="max-w-[220px] truncate text-[11px] text-ink" title={t.summary}>{t.summary}</span>
              <span className="text-[10px] text-ink-3" title={new Date(t.mtime).toLocaleString('sv')}>{new Date(t.mtime).toLocaleDateString('zh-CN')}</span>
            </button>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>发起采集</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="collect-demand">需求描述 *</Label>
              <Textarea
                id="collect-demand"
                rows={3}
                autoFocus
                placeholder="如：校园图书馆的老旧细节——木地板、借书卡、靠窗的旧阅览室"
                value={demand}
                onChange={(e) => setDemand(e.target.value)}
              />
              {demand.trim() &&
                (() => {
                  const dup = tasks.find(
                    (t) => (t.status === 'pending' || t.status === 'running') && t.demand && normDemand(t.demand) === normDemand(demand)
                  )
                  return dup ? (
                    <p className="rounded-md border border-warn/40 bg-warn-soft px-2.5 py-1.5 text-[11px] text-warn">
                      已有进行中的需求相同任务（{dup.summary}）——再次提交会重复采集；确认要复采再提交。
                    </p>
                  ) : null
                })()}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="collect-keywords">关键词（逗号分隔）</Label>
                <Input id="collect-keywords" placeholder="如：旧图书馆，借书卡" value={keywords} onChange={(e) => setKeywords(e.target.value)} onKeyDown={fieldSubmit} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="collect-category">目标类别</Label>
                <Input id="collect-category" placeholder="环境" value={category} onChange={(e) => setCategory(e.target.value)} onKeyDown={fieldSubmit} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="collect-source">来源偏好（可选）</Label>
              <Input id="collect-source" placeholder="如：知乎问答、博客；默认搜索引擎" value={source} onChange={(e) => setSource(e.target.value)} onKeyDown={fieldSubmit} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => void submit()} disabled={!demand.trim() || saving}>{saving ? '提交中…' : '提交任务'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 任务卡详情（管道回填的结果在此可见） */}
      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate" title={view?.summary ?? ''}>{view?.summary ?? ''}</DialogTitle>
            <p className="text-xs text-ink-3">{view?.file}</p>
          </DialogHeader>
          {view && (
            <div className="max-h-[55vh] space-y-2.5 overflow-auto">
              {(() => {
                const d = parseTaskCard(viewText)
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', STATUS_CLS[d.status] ?? STATUS_CLS.pending)}>{d.status}</span>
                      {d.category && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">{d.category}</span>}
                    </div>
                    {isTaskStale(d.status, view.mtime, Date.now()) && (
                      <p className="rounded-md border border-warn/40 bg-warn-soft px-2.5 py-1.5 text-[11px] text-warn">
                        任务已停滞 {staleDays(view.mtime, Date.now())} 天——本机管道似乎未处理该卡（可能停机/失败/被跳过），确认后删除重发起。
                      </p>
                    )}
                    <dl className="space-y-1 text-xs">
                      {d.demand && <Row k="需求" v={d.demand} />}
                      {d.keywords.length > 0 && <Row k="关键词" v={d.keywords.join('、')} />}
                      {d.source && <Row k="来源" v={d.source} />}
                      {d.createdAt && <Row k="创建" v={d.createdAt} />}
                      {d.result && (
                        <div className="flex items-start gap-2">
                          <dt className="w-12 shrink-0 text-ink-3">结果</dt>
                          <dd className="min-w-0 flex-1 break-all">
                            {isLibraryResultPath(d.result) ? (
                              <button
                                onClick={() => void togglePreview(d.result)}
                                title={preview?.rel === d.result ? '收起素材预览' : '点击在下方预览素材内容'}
                                className={cn(
                                  'inline-flex max-w-full items-start gap-1.5 break-all text-left font-mono text-[11px] transition-colors',
                                  preview?.rel === d.result ? 'font-medium text-accent' : 'text-accent hover:underline'
                                )}
                              >
                                <Eye className="mt-0.5 h-3 w-3 shrink-0" />
                                <span className="min-w-0 break-all">{d.result}</span>
                              </button>
                            ) : (
                              <span className="font-mono text-[11px] text-accent">{d.result}</span>
                            )}
                          </dd>
                        </div>
                      )}
                      {d.finishedAt && <Row k="完成" v={d.finishedAt} />}
                    </dl>
                    {isLibraryResultPath(d.result) && preview?.rel === d.result && (
                      <div className="overflow-hidden rounded-lg border border-hair">
                        <div className="flex items-center justify-between border-b border-hair bg-surface-2 px-3 py-1.5">
                          <span className="text-[11px] text-ink-3">素材预览（只读）</span>
                          <button onClick={() => setPreview(null)} className="flex shrink-0 items-center gap-1 text-[11px] text-ink-3 transition-colors hover:text-ink" title="收起预览" aria-label="收起预览">
                            <X className="h-3 w-3" /> 收起
                          </button>
                        </div>
                        <div className="max-h-[40vh] overflow-auto px-3 py-2">
                          {preview.text ? (
                            <div className="prose text-xs leading-relaxed text-ink-2">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.text}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-[11px] text-ink-3">未找到素材文件（可能已被移动或删除）。</p>
                          )}
                        </div>
                      </div>
                    )}
                    {d.body && (
                      <div className="prose max-h-[30vh] overflow-auto rounded-lg border border-hair bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{d.body}</ReactMarkdown>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setView(null)}>关闭</Button>
            <div className="flex-1" />
            {view && (view.status === 'pending' || view.status === 'failed') && (
              <Button
                variant="outline"
                onClick={() => view && void doRetry(view)}
                title="把任务卡重置为待处理（清掉旧结果），本机管道会重新采集"
              >
                <RefreshCw className="mr-1" /> 重发任务
              </Button>
            )}
            {view && (
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmDelete(view)
                  setView(null)
                }}
                title="删除这张任务卡（进系统废纸篓，可找回）"
              >
                删除该任务
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认（非终态二次确认：文案强调管道不再处理；终态仅提示可找回） */}
      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && !deleting && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除任务卡？</DialogTitle>
          </DialogHeader>
          {confirmDelete && (
            <div className="space-y-2 py-1 text-xs leading-relaxed text-ink-2">
              <p className="truncate font-medium text-ink" title={confirmDelete.summary}>{confirmDelete.summary}</p>
              {confirmDelete.status === 'done' || confirmDelete.status === 'failed' ? (
                <p>这张卡已终态。删除后可在系统废纸篓找回；已回填的素材草稿不受影响。</p>
              ) : (
                <p className="rounded-md border border-danger/40 bg-danger-soft px-2.5 py-1.5 text-danger">
                  任务尚未完成（{confirmDelete.status}）——删除后本机管道将不再处理它；如需重新采集，请用「重发任务」或重新发起。
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="destructive" disabled={deleting} onClick={() => confirmDelete && void doDelete(confirmDelete)}>
              {deleting ? '删除中…' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
