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
import { useFsEvents } from '../fs/useFsEvents'
import { isLibraryResultPath, isTaskStale, parseTaskCard, rebuildTaskCardForRetry } from '../../../../shared/taskCard'

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

export default function CollectionBar() {
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
  const events = useFsEvents(id)

  const refresh = useCallback(async () => {
    if (!id) return
    const list = await window.zhijuan.listDocs(id, '素材库/采集池')
    const nowMs = Date.now()
    const infos: TaskInfo[] = []
    for (const d of list) {
      // listDocs 返回相对 relDir 的路径，需拼回「素材库/采集池/」前缀（否则 readDoc 读到项目根同名文件/空）
      const text = (await window.zhijuan.readDoc(id, '素材库/采集池/' + d.file)) ?? ''
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
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const ev = events[events.length - 1]
    if (ev && ev.path.startsWith('素材库/采集池')) void refresh()
  }, [events, refresh])

  async function openView(t: TaskInfo) {
    setView(t)
    setPreview(null)
    setViewText((await window.zhijuan.readDoc(id, '素材库/采集池/' + t.file)) ?? '')
  }

  /** 结果行点击：读素材文件 → 详情内只读预览；已展开则收起 */
  async function togglePreview(rel: string) {
    if (preview?.rel === rel) {
      setPreview(null)
      return
    }
    const text = (await window.zhijuan.readDoc(id, rel)) ?? null
    setPreview({ rel, text })
  }

  async function submit() {
    if (!id || !demand.trim()) return
    setSaving(true)
    const ts = Date.now()
    const name = '任务_' + new Date(ts).toISOString().replace(/[-:TZ]/g, '').slice(0, 14)
    const kws = keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    const fm = [
      '---',
      'status: pending',
      '类别: ' + (category.trim() || '环境'),
      '关键词: [' + kws.join(', ') + ']',
      '需求: ' + demand.replace(/\n/g, ' '),
      '来源: ' + source.trim(),
      '创建: ' + new Date(ts).toLocaleString('sv'),
      '---',
      '',
      '# 采集任务：' + demand.replace(/\n/g, ' ').slice(0, 20),
      '',
      '**需求详情**：' + demand,
      '',
      '（由管道的后台代理按关键词抓取并回填，App 侧只负责登记。）',
      ''
    ].join('\n')
    await window.zhijuan.writeDoc(id, '素材库/采集池/' + name + '.md', fm)
    setOpen(false)
    setDemand(''); setKeywords(''); setCategory('环境'); setSource('')
    setSaving(false)
    await refresh()
  }

  /** 删除任务卡：走 doc:delete（进系统废纸篓可恢复），完成后关详情回列表（fs 事件也会触发刷新） */
  async function doDelete(t: TaskInfo) {
    setDeleting(true)
    await window.zhijuan.deleteDoc(id, '素材库/采集池/' + t.file)
    setDeleting(false)
    setConfirmDelete(null)
    setView(null)
    setPreview(null)
    await refresh()
  }

  /** 重发：按现卡字段重建为全新 pending 卡（清结果/完成，mtime 随写盘更新）——管道会重新处理 */
  async function doRetry(t: TaskInfo) {
    if (!t) return
    const text = (await window.zhijuan.readDoc(id, '素材库/采集池/' + t.file)) ?? ''
    const next = rebuildTaskCardForRetry(parseTaskCard(text))
    await window.zhijuan.writeDoc(id, '素材库/采集池/' + t.file, next)
    setView(null)
    setPreview(null)
    await refresh()
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
              <span className="max-w-[220px] truncate text-[11px] text-ink">{t.summary}</span>
              <span className="text-[10px] text-ink-3">{new Date(t.mtime).toLocaleString('sv')}</span>
            </button>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>发起采集</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>需求描述 *</Label>
              <Textarea rows={3} placeholder="如：校园图书馆的老旧细节——木地板、借书卡、靠窗的旧阅览室" value={demand} onChange={(e) => setDemand(e.target.value)} />
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
                <Label>关键词（逗号分隔）</Label>
                <Input placeholder="如：旧图书馆, 借书卡" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>目标类别</Label>
                <Input placeholder="环境" value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>来源偏好（可选）</Label>
              <Input placeholder="如：知乎问答、博客；默认搜索引擎" value={source} onChange={(e) => setSource(e.target.value)} />
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
            <DialogTitle className="truncate">{view?.summary ?? ''}</DialogTitle>
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
                          <button onClick={() => setPreview(null)} className="flex shrink-0 items-center gap-1 text-[11px] text-ink-3 transition-colors hover:text-ink" title="收起预览">
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
              <p className="truncate font-medium text-ink">{confirmDelete.summary}</p>
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
