import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { TooltipProvider } from './components/ui/tooltip'
import { useAppStore } from './store/app'
import Home from './pages/Home'
import Workspace from './pages/Workspace'
import Novel from './pages/Novel'
import Characters from './pages/Characters'
import Worldview from './pages/Worldview'
import Library from './pages/Library'
import Settings from './pages/Settings'

function Boot() {
  const loadSettings = useAppStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])
  return null
}

export default function App() {
  return (
    <TooltipProvider>
      <Boot />
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/project/:id" element={<Workspace />}>
            <Route index element={<Navigate to="novel" replace />} />
            <Route path="novel" element={<Novel />} />
            <Route path="characters" element={<Characters />} />
            <Route path="worldview" element={<Worldview />} />
            <Route path="library" element={<Library />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </TooltipProvider>
  )
}
