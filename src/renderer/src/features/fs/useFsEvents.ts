import { useEffect, useState } from 'react'
import type { FsEvent } from '../../../../shared/types'

/** 订阅某项目的文件系统事件（用于编辑器感知外部改动）；仅保留最近 50 条 */
export function useFsEvents(projectId: string) {
  const [events, setEvents] = useState<FsEvent[]>([])
  useEffect(() => {
    if (!projectId) return
    const off = window.zhijuan.onFsEvent((evt) => {
      if (evt.projectId === projectId) setEvents((arr) => [...arr.slice(-50), evt])
    })
    return off
  }, [projectId])
  return events
}
