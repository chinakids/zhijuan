import { useEffect, useRef, useState } from 'react'
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

/**
 * 感知项目目录变化：自上次消费以来出现 path 以 prefix 开头的新事件时回调 onChange。
 * 与「只看 events[events.length-1]」的旧模式不同：React 18 自动批处理会把同 tick 内多个 fs 事件
 * 并入同一次渲染，若只取最后一条且它不匹配前缀，匹配事件会被「顶掉」漏刷
 * （采集管道回填实踩 2026-09-12，CollectionBar 18dda8c 修复）。
 * 本原语按事件对象引用追踪已消费位：窗口内的批事件全部检查；prev 被 50 条窗口挤出时降级为全量
 * 检查（宁多勿漏，刷新读取幂等）；已消费的旧事件不会重复触发。
 */
export function useFsChanged(projectId: string, prefix: string, onChange: () => void): void {
  const events = useFsEvents(projectId)
  const prevLastRef = useRef<FsEvent | null>(null)
  useEffect(() => {
    if (!events.length) return
    const prev = prevLastRef.current
    prevLastRef.current = events[events.length - 1]
    let start = 0
    if (prev) {
      const i = events.indexOf(prev)
      start = i === -1 ? 0 : i + 1 // prev 已被窗口挤出 → 全量检查（安全降级）
    }
    if (events.slice(start).some((e) => e.path.startsWith(prefix))) onChange()
  }, [events, prefix, onChange])
}
