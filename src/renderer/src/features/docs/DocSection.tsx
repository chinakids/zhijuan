import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, History, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/EmptyState'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../../components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { cn } from '../../lib/utils'
import { isImeComposing } from '../../lib/ime'
import { ColHideButton, ColShowBar } from '../common/colFold'
import { useColFold, type ColFoldKey } from '../common/useColFold'
import DocEditor from '../editor/DocEditor'
import HistoryDrawer from '../editor/HistoryDrawer'
import { useUnsavedGuard } from '../editor/useUnsavedGuard'
import { useFsChanged, useFsEvents } from '../fs/useFsEvents'
import { resolveDocSel } from './docSel'
import { toast } from '../../store/toasts'

interface DocSectionProps {
  relDir: string
  /** 类别下默认存在的总览文件（relative to project） */
  overviewFile?: string
  addLabel: string
  /** 空态插图（人物/世界观等按目录类型传，保持与正文页同一视觉权重） */
  art?: 'character' | 'world' | 'material' | 'library'
  addHint: string
  emptyHint: string
  /** 侧栏组头名称（默认「文档」；按语义传入，如 人物档案 / 世界观设定） */
  listLabel?: string
  /** 折叠态持久化键（AppSettings.foldedCols；人物/世界观各自独立，勿共键） */
  foldKey: ColFoldKey
  /** 新建文件时写入的模板正文（需返回漏斗与角标即可） */
  templateFor?: (name: string) => string
  fileTitle?: (name: string) => string
  /** 编辑时剥离 front matter（如人物档案已有「别名」约定头） */
  withFm?: boolean
  /** 标为「历史」的文件名集合（file 字段口径，相对 relDir）：世界切片孤儿文件标注（2026-09-19 创作层） */
  staleDocFiles?: Set<string>
}

export default function DocSection({ relDir, overviewFile, addLabel, addHint, emptyHint, listLabel, templateFor, fileTitle, withFm, foldKey, staleDocFiles, art }: DocSectionProps) {
  const { id = '' } = useParams()
  const [files, setFiles] = useState<{ file: string; name: string }[]>([])
  const [sel, setSel] = useState<string | null>(overviewFile ?? null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  // 删除确认对象（文档列行操作；deleteDoc 走系统废纸篓可恢复，与章节删除同先例）
  const [deleting, setDeleting] = useState<{ file: string; name: string } | null>(null)
  // 重命名对象（文档列行操作；file 相对 relDir，newRel 由主进程返回）
  const [renaming, setRenaming] = useState<{ file: string; name: string } | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  // 宽窗手动折叠（HIG Sidebars show/hide；与 Novel 5376f30 同机制；折叠态持久化=AppSettings 跨重启记住侧栏；按导航页分键）
  const [colHidden, setColHidden] = useColFold(foldKey)
  const events = useFsEvents(id)
  // 版本历史抽屉（2026-10-27 未保存守卫轮）：人物/世界观已纳入 versionedRel 快照白名单，
  // 切片同步覆盖或误改可回退（复用正文 HistoryDrawer，rel 通用；恢复时自动再留一档可反悔）
  const [historyRel, setHistoryRel] = useState<string | null>(null)
  // 未保存守卫（2026-10-27 体验层 P1）：此前本页切文档行直接 setSel——有未保存改动即静默丢稿。
  // 与 Novel 切章守卫同语义（三选确认 / 保存被拦则留在原文档）；路由离开与关窗由 hook 一并覆盖。
  const saveRef = useRef<(() => Promise<boolean>) | null>(null)
  const guard = useUnsavedGuard({
    subject: `这份${addLabel}`,
    doSave: () => (saveRef.current ? saveRef.current() : false)
  })

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const list = await window.zhijuan.listDocs(id, relDir)
      setFiles(list)
      setLoadErr('')
      // 选中项不在列表（如 overview 缺失/被删）→ 置空显示「选择左侧一个文档开始」，不再指向不存在文档挂空编辑器（docSel.ts）
      setSel((s) => {
        const kept = resolveDocSel(s, list, relDir)
        if (kept) return kept
        // 没有有效选中时：优先总览，其次第一份文档（macOS 侧栏惯例：进目录先打开默认文档）
        if (overviewFile && list.some((f) => relDir + '/' + f.file === overviewFile)) return overviewFile
        // 无总览时保持空态（不随意打开某份文档：demo-multiline 防御态约定）
        return null
      })
    } catch (e) {
      setLoadErr(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [id, relDir, overviewFile])

  useEffect(() => {
    // 挂载/切项目先回 loading 并清旧项目文档（Timeline 样板，2026-09-22 体验层 stale 核查）：
    // 选中项置空防旧项目文档名在新项目加载窗口触发「读取失败」卡闪现；fs 触发的 refresh 不受影响。
    setLoading(true)
    setFiles([])
    setSel(null)
    setLoadErr('')
    void refresh()
  }, [refresh])

  useFsChanged(id, relDir + '/', () => void refresh())

  const extVersion = useMemo(() => (sel ? events.filter((e) => e.path === sel).length : 0), [events, sel])

  /** 切文档（守卫版）：无未保存改动直接切；有则三选确认，取消或保存被拦都留在原文档 */
  async function selectDoc(rel: string) {
    if (rel === sel) return
    if (!(await guard.confirmLeave('switch'))) return
    // 明确放行（已保存/放弃）：先清 dirty，避免新文档装载瞬间旧 dirty 再触发一次确认
    guard.setDirty(false)
    setSel(rel)
  }

  async function createDoc() {
    if (!id || !name.trim()) return
    const typed = name.trim()
    // 查重（写盘前）：目录内已有同名 → 不覆盖，自动改名「名字 2 / 名字 3」并提示
    let safe = typed
    try {
      safe = await window.zhijuan.uniqueDocName(id, relDir, typed)
    } catch {
      // 查重失败不阻断新建（按原名写；主进程名字已 sanitize）
    }
    const rel = `${relDir}/${safe}.md`
    try {
      await window.zhijuan.writeDoc(id, rel, templateFor ? templateFor(safe) : `# ${safe}\n\n`)
      if (safe !== typed) {
        toast.add({ kind: 'info', title: `已存为「${safe}」`, description: `目录里已有同名${addLabel}（或名字含特殊字符），原档案未被覆盖` })
      }
      setCreating(false)
      setName('')
      await refresh()
      // 新建后跳到新档：当前档若有未保存改动，同样先确认（与切文档同一守卫）
      await selectDoc(rel)
    } catch (e) {
      toast.add({ kind: 'error', title: `新建${addLabel}失败`, description: String((e as Error).message ?? e) })
    }
  }

  async function doRename() {
    if (!id || !renaming || !renameVal.trim()) return
    const rel = `${relDir}/${renaming.file}`
    try {
      const r = await window.zhijuan.docRename(id, rel, renameVal.trim())
      if (!r.ok) {
        toast.add({ kind: 'error', title: '重命名失败', description: r.error })
        return
      }
      toast.add({ kind: 'success', title: '已重命名', description: fileTitle ? fileTitle(renameVal.trim()) : renameVal.trim() })
      setRenaming(null)
      setRenameVal('')
      await refresh()
      if (sel === rel && r.newRel) setSel(r.newRel)
    } catch (e) {
      toast.add({ kind: 'error', title: '重命名失败', description: String((e as Error).message ?? e) })
    }
  }

  async function doDelete() {
    if (!id || !deleting) return
    const rel = `${relDir}/${deleting.file}`
    try {
      const r = await window.zhijuan.deleteDoc(id, rel)
      if (!r.ok) {
        toast.add({ kind: 'error', title: '删除失败', description: r.error })
        setDeleting(null)
        return
      }
      toast.add({ kind: 'success', title: '已移入废纸篓（可恢复）', description: fileTitle ? fileTitle(deleting.name) : deleting.name })
      setDeleting(null)
      if (sel === rel) setSel(null)
      await refresh()
    } catch (e) {
      toast.add({ kind: 'error', title: '删除失败', description: String((e as Error).message ?? e) })
      setDeleting(null)
    }
  }

  // 文档列行操作菜单（「⋯」下拉 与 右键 共源渲染）：HIG Context menus——两个菜单形态一致、动作一致；
  // 破坏性项置末 + danger 红字（HIG「list them at the end and identify them as destructive」）；先例=Novel.renderRowMenu
  const renderDocMenu = (Item: React.ElementType, f: { file: string; name: string }) => (
    <>
      {/* 重命名只对「独立档案」开放：总览（页面固定引用 overviewFile；file 相对 relDir，故比对文件名）与 切片_*（文件名即切片名，改名会产生孤儿）不给入口 */}
      {f.file !== overviewFile?.split('/').pop() && !f.file.startsWith('切片_') && (
        <Item
          onSelect={() => {
            setRenaming(f)
            setRenameVal(fileTitle ? fileTitle(f.name) : f.name)
          }}
        >
          <Pencil className="h-4 w-4" /> 重命名…
        </Item>
      )}
      <Item onSelect={() => setHistoryRel(relDir + '/' + f.file)}>
        <History className="h-4 w-4" /> 版本历史
      </Item>
      <Item className="text-danger focus:bg-danger/10 focus:text-danger" onSelect={() => setDeleting(f)}>
        删除
      </Item>
    </>
  )

  return (
    <div className="flex h-full min-h-0">
      {!colHidden && (
        <aside data-testid="doc-col" className="flex w-60 shrink-0 flex-col border-r border-hair bg-surface-2">
          <div className="flex items-center justify-between px-3 pb-2 pt-3">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-3">{listLabel ?? '文档'}</span>
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
              <p className="mt-0.5 break-all text-xs text-ink-3">{loadErr}</p>
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
            <ContextMenu key={f.file}>
              <ContextMenuTrigger asChild>
                <div className="group relative mb-0.5">
                  <button
                    onClick={() => void selectDoc(relDir + '/' + f.file)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg py-2 pl-3 pr-8 text-left transition-colors',
                      sel === relDir + '/' + f.file ? 'bg-accent-soft' : 'hover:bg-surface'
                    )}
                  >
                    <FileText className={cn('h-3.5 w-3.5 shrink-0', sel === relDir + '/' + f.file ? 'text-accent' : 'text-ink-3')} />
                    <span className={cn('truncate text-sm', sel === relDir + '/' + f.file ? 'font-medium text-accent' : 'text-ink')} title={fileTitle ? fileTitle(f.name) : f.name}>
                      {fileTitle ? fileTitle(f.name) : f.name}
                    </span>
                    {staleDocFiles?.has(f.file) && (
                      <span
                        title="切片已改名：此文件保留为历史，不再参与后续同步与创作上下文"
                        className="ml-auto mr-1 shrink-0 rounded bg-amber-500/15 px-1 py-px text-[10px] leading-tight text-amber-700 dark:text-amber-300"
                      >
                        历史
                      </span>
                    )}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="文档操作"
                        aria-label="文档操作"
                        data-testid="doc-row-menu"
                        className={cn(
                          'absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 text-ink-3 hover:text-ink data-[state=open]:bg-well data-[state=open]:text-ink',
                          sel === relDir + '/' + f.file ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
                        )}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {renderDocMenu(DropdownMenuItem, f)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {renderDocMenu(ContextMenuItem, f)}
              </ContextMenuContent>
            </ContextMenu>
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
              <span className="truncate text-sm font-medium text-ink" title={sel}>{fileTitle ? fileTitle(sel.split('/').pop()!.replace(/\.md$/, '')) : sel}</span>
              <span className="flex-1" />
              <span className="text-xs text-ink-3">设定由正文保存时的切片同步维护</span>
            </div>
            <div className="min-h-0 flex-1">
              <DocEditor
                projectId={id}
                rel={sel}
                withFm={withFm}
                extVersion={extVersion}
                saveHandleRef={saveRef}
                onDirtyChange={guard.reportDirty}
                onSave={() => void refresh()}
                anno={false}
              />
            </div>
          </>
        ) : (
          <EmptyState
            className="h-full"
            art={art}
            title="还没有打开文档"
            hint={colHidden ? `点上方「显示${listLabel ?? '文档'}列表」恢复侧栏，选择一个文档开始。` : '选择左侧一个文档开始'}
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
                <Plus /> 新建{addLabel ?? '文档'}
              </Button>
            }
            dataTestId="doc-empty"
          />
        )}
      </main>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-sm" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>新建{addLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="doc-name">名字 *</Label>
            <Input
              id="doc-name"
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

      {/* 文档删除确认：移入系统废纸篓（可恢复）——与章节删除同先例；删当前选中项后置空回「选择左侧一个文档开始」 */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除文档</DialogTitle>
            <DialogDescription>
              {fileTitle ? fileTitle(deleting?.name ?? '') : deleting?.name ?? ''}将移入系统废纸篓（可恢复）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button className="text-danger" onClick={() => void doDelete()}>移入废纸篓</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 版本历史抽屉（人物/世界观已入版本化白名单：覆盖/误改可回退） */}
      <HistoryDrawer projectId={id} rel={historyRel ?? ''} open={historyRel !== null} onClose={() => setHistoryRel(null)} />
      {/* 未保存三选确认（切文档 / 路由离开 / 关窗共用同一弹窗，形态与 Novel 守卫一致） */}
      {guard.dialog}
      {/* 文档重命名：只改文件名（首个「# 旧名」标题与版本历史目录由主进程随动） */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>重命名{addLabel}</DialogTitle>
            <DialogDescription>只改文件名，内容保持不动；同名已存在时会提示，不会覆盖。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="doc-rename">新名字 *</Label>
            <Input
              id="doc-rename"
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                // IME 组合期 Enter 只确认候选，不改名（F-IME-03）
                if (isImeComposing(e)) return
                if (e.key === 'Enter' && renameVal.trim()) void doRename()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>取消</Button>
            <Button onClick={() => void doRename()} disabled={!renameVal.trim() || renameVal.trim() === (renaming ? (fileTitle ? fileTitle(renaming.name) : renaming.name) : '')}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
