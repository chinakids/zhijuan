import { useCallback, useEffect, useState } from 'react'
import { useParams, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import type { FsEvent, ProjectSummary } from '../../../shared/types'
import SectionNav, { type NavCounts } from '../features/nav/SectionNav'
import { ListChecks } from 'lucide-react'
import { useProposalStore } from '../store/proposals'
import ProposalDrawer from '../features/proposals/ProposalDrawer'
import ProjectGuide from '../features/guide/ProjectGuide'

const sectionTitles: Record<string, string> = {
  novel: '正文创作',
  characters: '人物设定',
  worldview: '世界观设定',
  outline: '大纲区',
  library: '素材库',
  settings: '设置'
}

const emptyCounts: NavCounts = { novel: 0, characters: 0, worldview: 0, outline: 0, library: 0 }

export default function Workspace() {
  const { id } = useParams<{ id: string }>()
  const loc = useLocation()
  const [sp, setSp] = useSearchParams()
  const [guideOpen, setGuideOpen] = useState(() => sp.get('guide') === '1')
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [counts, setCounts] = useState<NavCounts>(emptyCounts)

  const refreshAll = useCallback(async () => {
    if (!id) return
    const list = await window.zhijuan.listProjects()
    const me = list.find((p) => p.id === id) ?? null
    setProject(me)
    const [chs, chars, world, outline, lib] = await Promise.all([
      window.zhijuan.listChapters(id),
      window.zhijuan.listDocs(id, '人物'),
      window.zhijuan.listDocs(id, '世界观'),
      window.zhijuan.listDocs(id, '大纲'),
      window.zhijuan.listDocs(id, '素材库')
    ])
    setCounts({
      novel: chs.length,
      characters: chars.filter((d) => d.file !== '人物/总览.md').length,
      worldview: world.filter((d) => d.file !== '世界观/总纲.md').length,
      outline: outline.filter((d) => d.file !== '索引.md').length,
      library: lib.filter((d) => !d.file.startsWith('素材库/采集池')).length
    })
  }, [id])

  useEffect(() => {
    if (!id) return
    void window.zhijuan.openProject(id)
    void refreshAll()
    const off = window.zhijuan.onFsEvent((evt: FsEvent) => {
      if (evt.projectId === id) void refreshAll()
    })
    return off
  }, [id, refreshAll])

  const seg = loc.pathname.split('/').filter(Boolean)
  const section = seg[1] ?? 'novel'
  const title = sectionTitles[section] ?? '织卷'
  const proposals = useProposalStore((s) => s.list)
  const tick = useProposalStore((s) => s.tick)
  const pending = proposals.filter((p) => p.status === 'pending').length
  const [drawerOpen, setDrawerOpen] = useState(false)
  const refreshProposals = useCallback(() => {
    if (id) void useProposalStore.getState().refresh(id)
  }, [id])
  useEffect(() => {
    refreshProposals()
  }, [refreshProposals, tick])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-3">项目不存在或已被删除。</div>
    )
  }

  return (
    <div className="flex h-full">
      <SectionNav projectId={project.id} projectName={project.name} counts={counts} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-hair bg-surface px-4">
          <h2 className="text-sm font-medium">{title}</h2>
          <div className="flex-1" />
          {pending > 0 && (
            <button onClick={() => setDrawerOpen(true)} className="flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs text-warn transition-colors hover:brightness-95">
              <ListChecks className="h-3.5 w-3.5" />
              待确认提案 {pending}
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </div>
      {drawerOpen && (
        <ProposalDrawer projectId={project.id} list={proposals} onChanged={refreshProposals} onClose={() => setDrawerOpen(false)} />
      )}
      <ProjectGuide
        projectId={project.id}
        projectName={project.name}
        open={guideOpen}
        onClose={() => {
          setGuideOpen(false)
          setSp({}, { replace: true })
        }}
      />
    </div>
  )
}
