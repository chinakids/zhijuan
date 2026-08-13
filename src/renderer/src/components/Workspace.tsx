import { useState } from 'react'
import type { Project } from '../../../shared/types'
import WorldviewView from './WorldviewView'
import CharactersView from './CharactersView'
import ChaptersView from './ChaptersView'

type Tab = 'worldview' | 'characters' | 'chapters'

interface Props {
  project: Project
  onBack: () => void
  onSave: (p: Project) => void
}

export default function Workspace({ project, onBack, onSave }: Props) {
  const [tab, setTab] = useState<Tab>('worldview')

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="btn btn-sm" onClick={onBack}>
            ← 项目
          </button>
          <strong className="proj-name">{project.name}</strong>
        </div>
        <nav className="nav">
          <button className={tab === 'worldview' ? 'active' : ''} onClick={() => setTab('worldview')}>
            🌍 世界观
          </button>
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}>
            👤 人物设定
          </button>
          <button className={tab === 'chapters' ? 'active' : ''} onClick={() => setTab('chapters')}>
            📖 章节
          </button>
        </nav>
      </aside>
      <main className="main">
        {tab === 'worldview' && <WorldviewView project={project} onSave={onSave} />}
        {tab === 'characters' && <CharactersView project={project} onSave={onSave} />}
        {tab === 'chapters' && <ChaptersView project={project} onSave={onSave} />}
      </main>
    </div>
  )
}
