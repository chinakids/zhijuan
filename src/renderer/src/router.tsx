import { createHashRouter, Navigate, Outlet } from 'react-router-dom'
import CommandPalette from './features/command/CommandPalette'
import Home from './pages/Home'
import Workspace from './pages/Workspace'
import Novel from './pages/Novel'
import Characters from './pages/Characters'
import Worldview from './pages/Worldview'
import Outline from './pages/Outline'
import Timeline from './pages/Timeline'
import Library from './pages/Library'
import Settings from './pages/Settings'

/** 路由单例（data router，2026-09-24 创作层）。
 * 为什么从 <HashRouter>（declarative）换成 createHashRouter（data）：
 * 正文页 dirty 时「切到其他页面/项目/首页」目前无守卫（切章=组件内 state 变化、关窗=beforeunload，
 * 路由切换都不触发）——Novel 卸载即丢未保存内容。useBlocker（路由级导航拦截）只在 data router 下可用
 * （本地 v7.18.3 源码 useDataRouterContext 取证）。导航全部经本 router（router.navigate / router hooks），
 * 引擎徽章/系统菜单原本直接 window.location.hash 赋值属外部导航，data router 下 blocker 对其
 * 「fail silently in production」（本地源码警告原文），已一并改为 router.navigate。 */
function Shell() {
  return (
    <>
      <Outlet />
      {/* 全局命令面板：⌘K 导航（须在 Router 内，用 router hooks） */}
      <CommandPalette />
    </>
  )
}

export const router = createHashRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      // 全局设置页（系统菜单 织卷→设置… 指向 #/settings；项目内 SectionNav 仍走 /project/:id/settings）
      { path: 'settings', element: <Settings /> },
      {
        path: 'project/:id',
        element: <Workspace />,
        children: [
          { index: true, element: <Navigate to="novel" replace /> },
          { path: 'novel', element: <Novel /> },
          { path: 'characters', element: <Characters /> },
          { path: 'worldview', element: <Worldview /> },
          { path: 'outline', element: <Outline /> },
          { path: 'timeline', element: <Timeline /> },
          { path: 'library', element: <Library /> },
          { path: 'settings', element: <Settings /> }
        ]
      }
    ]
  }
])
