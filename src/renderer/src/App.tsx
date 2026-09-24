import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { TooltipProvider } from './components/ui/tooltip'
import { useAppStore } from './store/app'
import { useAgentStore } from './features/agent/store'
import { router } from './router'
import WindowChrome from './components/WindowChrome'
import MenuBridge from './features/menu/menuBus'
import { Toaster, toast } from './components/ui/toast'

function Boot() {
  const loadSettings = useAppStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])
  return null
}

/** 全局桥：编辑器划词浮层「添加到对话」→ 对话引用（任何文档页都生效）。
 * detail 形态（2026-09-23 体验层）：对象 {text, src}（新通道，src=来源显示名）或纯字符串（兼容旧通道，无来源）。 */
function QuoteBridge() {
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail
      let added = false
      if (d && typeof d === 'object' && typeof d.text === 'string' && d.text.trim()) {
        useAgentStore.getState().setQuote({ text: d.text.trim(), src: typeof d.src === 'string' && d.src ? d.src : undefined })
        added = true
      } else if (typeof d === 'string' && d.trim()) {
        useAgentStore.getState().setQuote({ text: d.trim() })
        added = true
      }
      // 非正文页划词零确认面（2026-09-24 体验层）：人物/世界观/素材/大纲页没有挂 AgentPanel，
      // 「添加到对话」后引用只在正文输入区提示条可见——作者当场无感知（Cursor pills 基线同类缺口）。
      // HIG Feedback「Consider integrating status feedback into your interface」「confirm that a significant action has completed」
      // ——正文页提示条=集成式反馈（含取消入口），仅非正文页补轻量确认；QuoteBridge 在 Router 外，页面判定用 hash（WindowChrome 同法）。
      if (added && !window.location.hash.includes('/novel')) {
        toast.add({ kind: 'success', title: '已添加到对话', description: '回到「正文创作」页，可在输入区查看或取消' })
      }
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
      {/* 系统菜单桥（mac 菜单栏 → 单点分发 + 启用态上报 + 全局快捷键速查），无 router 依赖 */}
      <MenuBridge />
      {/* 窗口骨架：自定义标题栏（mac）在上，内容区占满剩余空间 */}
      <div className="flex h-screen flex-col overflow-hidden">
        <WindowChrome />
        <div className="relative min-h-0 flex-1">
          {/* data router（createHashRouter 单例，见 router.tsx）：useBlocker 路由级守卫的前提；
              命令面板/各页/嵌套路由都在 Shell 内。 */}
          <RouterProvider router={router} />
        </div>
      </div>
      {/* 全局通知堆栈：右上角，层级高于面板/抽屉，透明不挡交互 */}
      <Toaster />
    </TooltipProvider>
  )
}
