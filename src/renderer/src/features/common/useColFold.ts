import { useCallback, useEffect, useState } from 'react'

/**
 * 导航列折叠态持久化（2026-09-18 体验层；HIG Sidebars show/hide + macOS 惯例：记住侧栏状态跨重启）。
 * 先例＝AgentPanel 面板宽度（agentPanelWidth 平铺 AppSettings，组件直读直写，无全局 store）：
 * 列折叠是单路由局部 UI 态，页面重挂载时从设置读回即可；useUiStore 只用于跨组件实时共享（窄窗判据），
 * 本态无跨组件消费者，不桥接（17:15 轮「经 useUiStore 桥接」仅为初稿设想，实现按 AgentPanel 先例）。
 * 坑：setSettings 是浅合并——foldedCols 必须传全量对象（从当前设置取 cur 再并单键），否则丢其它页折叠态。
 */

/** 导航列折叠键（与 AppSettings.foldedCols 对齐：五个导航页各一键——人物/世界观共用 DocSection 但折叠态相互独立） */
export type ColFoldKey = 'novel' | 'characters' | 'worldview' | 'outline' | 'library'

export function useColFold(key: ColFoldKey): [boolean, (v: boolean) => void] {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let alive = true
    window.zhijuan
      .getSettings()
      .then((s) => {
        if (alive) setHidden(!!s.foldedCols[key])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [key])
  const setFold = useCallback(
    (v: boolean) => {
      setHidden(v)
      void window.zhijuan
        .getSettings()
        .then((s) => window.zhijuan.setSettings({ foldedCols: { ...s.foldedCols, [key]: v } }))
        .catch(() => {})
    },
    [key]
  )
  return [hidden, setFold]
}
