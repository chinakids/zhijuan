// ===== 最近打开的项目（应用内部状态，非用户设置） =====
// 存储：userData/zhijuan-recents.json（与 zhijuan-settings.json 同目录但分开：
//        settings 是用户可编辑的设置（有设置页），recents 是内部行为记录，混进去会让设置页语义含混）。
// 语义：recordOpen 在 project:open（进入项目工作区）时调用；去重、置顶、截断上限。
import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import type { RecentEntry } from '../shared/projects'

export const MAX_RECENTS = 12

function recentsFile(): string {
  return join(app.getPath('userData'), 'zhijuan-recents.json')
}

function safeParse(raw: string): RecentEntry[] {
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (e): e is RecentEntry => typeof e?.id === 'string' && typeof e?.openedAt === 'number'
    )
  } catch {
    return []
  }
}

export function getRecentEntries(): RecentEntry[] {
  try {
    if (!existsSync(recentsFile())) return []
    return safeParse(readFileSync(recentsFile(), 'utf-8')).sort((a, b) => b.openedAt - a.openedAt)
  } catch {
    return []
  }
}

/** 删除项目时调用：清掉残留记录（对偶于 recordOpen） */
export function removeRecent(id: string): void {
  if (!id) return
  const next = getRecentEntries().filter((e) => e.id !== id)
  try {
    mkdirSync(dirname(recentsFile()), { recursive: true })
    writeFileAtomic(recentsFile(), JSON.stringify(next, null, 2))
  } catch {
    /* 静默 */
  }
}

/** 打开项目时调用：id 去重置顶、截断上限、写盘（写失败静默——recents 丢了不影响主功能） */
export function recordOpen(id: string): void {
  if (!id) return
  const cur = getRecentEntries().filter((e) => e.id !== id)
  cur.unshift({ id, openedAt: Date.now() })
  const next = cur.slice(0, MAX_RECENTS)
  try {
    mkdirSync(dirname(recentsFile()), { recursive: true })
    writeFileAtomic(recentsFile(), JSON.stringify(next, null, 2))
  } catch {
    /* 静默 */
  }
}
