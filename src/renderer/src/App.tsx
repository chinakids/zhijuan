import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TooltipProvider } from './components/ui/tooltip'
import { useAppStore } from './store/app'
import { useAgentStore } from './features/agent/store'
import WindowChrome from './components/WindowChrome'
import Home from './pages/Home'
import Workspace from './pages/Workspace'
import Novel from './pages/Novel'
import Characters from './pages/Characters'
import Worldview from './pages/Worldview'
import Outline from './pages/Outline'
import Timeline from './pages/Timeline'
import Library from './pages/Library'
import Settings from './pages/Settings'

function Boot() {
  const loadSettings = useAppStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])
  return null
}

/** 全局桥：编辑器划词浮层「添加到对话」→ 对话引用（任何文档页都生效） */
function QuoteBridge() {
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent<string>).detail
      if (typeof t === 'string' && t.trim()) useAgentStore.getState().setQuote(t.trim())
    }
    window.addEventListener('zj:quote-text', h)
    return () => window.removeEventListener('zj:quote-text', h)
  }, [])
  return null
}

export default function App() {
  return (
    <TooltipProvider>
      <Boot />
      <QuoteBridge />
      {/* 窗口骨架：自定义标题栏（mac）在上，内容区占满剩余空间 */}
      <div className="flex h-screen flex-col overflow-hidden">
        <WindowChrome />
        <div className="relative min-h-0 flex-1">
          <HashRouter>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/project/:id" element={<Workspace />}>
                <Route index element={<Navigate to="novel" replace />} />
                <Route path="novel" element={<Novel />} />
                <Route path="characters" element={<Characters />} />
                <Route path="worldview" element={<Worldview />} />
                <Route path="outline" element={<Outline />} />
                <Route path="timeline" element={<Timeline />} />
                <Route path="library" element={<Library />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Routes>
          </HashRouter>
        </div>
      </div>
    </TooltipProvider>
  )
}
