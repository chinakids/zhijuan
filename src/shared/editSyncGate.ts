// ===== 正文写入后切片同步门（shared · 纯逻辑可测）=====
// 正文为源、设定为流：任何正文写入入口（保存/分幕采纳/EditCard 采纳/批注提案接受/历史恢复）
// 后都要触发切片同步；同文件 60s 窗口内只放行一次（一次对话连续改写不重复烧引擎），
// 失败由调用方 clear 以允许重试（与 AgentPanel 原口径一致）。
export const EDIT_SYNC_WINDOW_MS = 60_000

/** 判定 rel 是否指向正文文档（约定 正文/ 前缀；人物/世界观/大纲审读等一律不触发正文同步） */
export function isChapterTarget(rel: string | undefined | null): boolean {
  return typeof rel === 'string' && rel.startsWith('正文/')
}

/** 节流门：key = projectId|rel；tryRun 返回 true 才执行（并记时） */
export class EditSyncGate {
  private last = new Map<string, number>()

  tryRun(key: string, now = Date.now(), windowMs = EDIT_SYNC_WINDOW_MS): boolean {
    const at = this.last.get(key)
    if (at !== undefined && now - at < windowMs) return false
    this.last.set(key, now)
    return true
  }

  clear(key: string): void {
    this.last.delete(key)
  }

  reset(): void {
    this.last.clear()
  }
}
