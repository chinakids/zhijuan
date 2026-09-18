import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, Plus } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/EmptyState'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { cn } from '../../lib/utils'
import { isImeComposing } from '../../lib/ime'
import { ColHideButton, ColShowBar } from '../common/colFold'
import DocEditor from '../editor/DocEditor'
import { useFsChanged, useFsEvents } from '../fs/useFsEvents'
import { toast } from '../../store/toasts'

interface DocSectionProps {
  relDir: string
  /** 类别下默认存在的总览文件（relative to project） */
  overviewFile?: string
  addLabel: string
  addHint: string
  emptyHint: string
  /** 侧栏组头名称（默认「文档」；按语义传入，如 人物档案 / 世界观设定） */
  listLabel?: string
  /** 新建文件时写入的模板正文（需返回漏斗与角标即可） */
  templateFor?: (name: string) => string
  fileTitle?: (name: string) => string
  /** 编辑时剥离 front matter（如人物档案已有「别名」约定头） */
  withFm?: boolean
}

export default function DocSection({ relDir, overviewFile, addLabel, addHint, emptyHint, listLabel, templateFor, fileTitle, withFm }: DocSectionProps) {
  const { id = '' } = useParams()
  const [files, setFiles] = useState<{ file: string; name: string }[]>([])
  const [sel, setSel] = useState<string | null>(overviewFile ?? null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  // 宽窗手动折叠（HIG Sidebars show/hide；与 Novel 5376f30 同机制，会话内状态不持久化）
  const [colHidden, setColHidden] = useState(false)
  const events = useFsEvents(id)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const list = await window.zhijuan.listDocs(id, relDir)
      setFiles(list)
      setLoadErr('')
      setSel((s) => (s && list.some((f) => relDir + '/' + f.file === s) ? s : overviewFile ?? null))
    } catch (e) {
      setLoadErr(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [id, relDir, overviewFile])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useFsChanged(id, relDir + '/', () => void refresh())

  const extVersion = useMemo(() => (sel ? events.filter((e) => e.path === sel).length : 0), [events, sel])

  async function createDoc() {
    if (!id || !name.trim()) return
    const safe = name.trim()
    const rel = `${relDir}/${safe}.md`
    try {
      await window.zhijuan.writeDoc(id, rel, templateFor ? templateFor(safe) : `# ${safe}\n\n`)
      setCreating(false)
      setName('')
      await refresh()
      setSel(rel)
    } catch (e) {
      toast.add({ kind: 'error', title: `新建${addLabel}失败`, description: String((e as Error).message ?? e) })
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {!colHidden && (
        <aside data-testid="doc-col" className="flex w-60 shrink-0 flex-col border-r border-hair bg-surface-2">
          <div className="flex items-center justify-between px-3 pb-2 pt-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{listLabel ?? '文档'}</span>
            <span className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" title={addHint} aria-label={addHint} onClick={() => setCreating(true)}>
                <Plus />
              </Button>
              <ColHideButton label={listLabel ?? '文档'} onClick={() => setColHidden(true)} />
            </span>
          </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-ink-3">
              <LoadingIndicator size={16} />
              <span>正在读取…</span>
            </div>
          )}
          {!loading && loadErr && (
            <div className="px-2 py-5 text-center">
              <p className="text-xs text-danger">读取失败</p>
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
          {!loading && !loadErr && files.length === 0 && <EmptyState compact hint={emptyHint} dataTestId="empty-docs" />}
          {files.map((f) => (
            <button
              key={f.file}
              onClick={() => setSel(relDir + '/' + f.file)}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                sel === relDir + '/' + f.file ? 'bg-accent-soft' : 'hover:bg-surface'
              )}
            >
              <FileText className={cn('h-3.5 w-3.5 shrink-0', sel === relDir + '/' + f.file ? 'text-accent' : 'text-ink-3')} />
              <span className={cn('truncate text-sm', sel === relDir + '/' + f.file ? 'font-medium text-accent' : 'text-ink')}>
                {fileTitle ? fileTitle(f.name) : f.name}
              </span>
            </button>
          ))}
        </div>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {colHidden && (
          <ColShowBar label={listLabel ?? '文档'} onShow={() => setColHidden(false)} dataTestId="doc-col-show" />
        )}
        {sel ? (
          <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair px-4">
              <span className="truncate text-sm font-medium text-ink">{fileTitle ? fileTitle(sel.split('/').pop()!.replace(/\.md$/, '')) : sel}</span>
              <span className="flex-1" />
              <span className="text-[11px] text-ink-3">设定由正文保存时的切片同步维护（S4） · ⌘S 保存</span>
            </div>
            <div className="min-h-0 flex-1">
              <DocEditor projectId={id} rel={sel} withFm={withFm} extVersion={extVersion} onSave={() => void refresh()} anno={false} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-ink-3">
            {colHidden ? `点上方「显示${listLabel ?? '文档'}列表」恢复侧栏，选择一个文档开始。` : '选择左侧一个文档开始'}
          </div>
        )}
      </main>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-sm" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>新建{addLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>名字 *</Label>
            <Input
              autoFocus
              placeholder="如：夏晚晴"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // IME 组合期 Enter 只确认候选，不建档（F-IME-03）
                if (isImeComposing(e)) return
                if (e.key === 'Enter' && name.trim()) void createDoc()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>取消</Button>
            <Button onClick={() => void createDoc()} disabled={!name.trim()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
