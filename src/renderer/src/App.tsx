import { useCallback, useEffect, useState } from 'react'
import type { Project } from '../../shared/types'
import Workspace from './components/Workspace'

interface ProjectRow {
  id: string
  name: string
  description: string
  updatedAt: number
}

export default function App() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const list = (await window.zhijuan.listProjects()) as ProjectRow[]
    setProjects(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function openProject(id: string) {
    const p = (await window.zhijuan.loadProject(id)) as Project | null
    if (p) setProject(p)
  }

  async function createProject() {
    if (!name.trim()) return
    const p = (await window.zhijuan.createProject(name.trim(), desc.trim())) as Project
    setProject(p)
    setName('')
    setDesc('')
    setCreating(false)
    refresh()
  }

  async function removeProject(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    await window.zhijuan.deleteProject(id)
    if (project?.id === id) setProject(null)
    refresh()
  }

  async function onSaveProject(updated: Project) {
    const saved = (await window.zhijuan.saveProject(updated)) as Project
    setProject(saved)
    refresh()
  }

  if (project) {
    return <Workspace project={project} onBack={() => setProject(null)} onSave={onSaveProject} />
  }

  return (
    <div className="shell">
      <header className="app-bar">
        <h1>织卷</h1>
        <span className="sub">AI 辅助小说创作工作台</span>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          ＋ 新建项目
        </button>
      </header>

      {creating && (
        <div className="modal-mask">
          <div className="modal">
            <h3>新建小说项目</h3>
            <input
              autoFocus
              placeholder="项目名（如：都市短篇合集）"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              placeholder="一句话简介（可选）"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setCreating(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={createProject} disabled={!name.trim()}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="project-list">
        {loading && <p className="empty">正在读取项目库…</p>}
        {!loading && projects.length === 0 && (
          <p className="empty">还没有项目。点右上角「新建项目」开始第一本。</p>
        )}
        {projects.map((p) => (
          <div key={p.id} className="project-card" onClick={() => openProject(p.id)}>
            <div>
              <strong>{p.name}</strong>
              <p>{p.description || '（无简介）'}</p>
              <small>{new Date(p.updatedAt).toLocaleString()}</small>
            </div>
            <button className="btn btn-danger btn-sm" onClick={(e) => removeProject(p.id, e)}>
              删除
            </button>
          </div>
        ))}
      </main>
    </div>
  )
}
