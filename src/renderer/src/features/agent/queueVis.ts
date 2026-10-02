// 排队条目可视化（2026-09-30 体验层候选 1·05:15 轮）——排队命令/消息可视化列表
// 背景：生成中/导演执行中再发的命令与消息仅弹 toast「消息已排队/命令已排队」（8ec9cdb/c3fb655），
//       队列内容作者不可见——排了 2-3 条后无法确认「都排上了/都是什么」。
// 调研：Claude Code 官方 interactive-mode（code.claude.com/docs/en/interactive-mode）现行范式=
//       「lists the queued entries in the conversation until it sends them」+「Sent and queued messages
//       show in gray until Claude starts responding」——排队条目列在对话流中灰显，直到开始响应。
//       本模块据此刻意对照：排队条目以灰显气泡渲染在消息流末尾（不入 store、不进上下文载荷），
//       发送时自然入流（shift 后 append），作者可逐条取消。
// 纯函数（可单测）：collectQueued / removeQueuedByQid / newQid；不改排队机制与 drain 语义（8ec9cdb 已定）。

export interface MsgQueued {
  qid: string
  raw: string
  project: string
}

export interface CmdQueued {
  qid: string
  raw: string
  projectId: string
}

export interface QueuedEntry {
  qid: string
  kind: 'msg' | 'cmd'
  text: string
  project: string
}

/** 组装「当前面板项目」可见的排队条目：消息队列在前（80ms 先出）、命令队列在后（150ms 后出），与 drain 顺序一致 */
export function collectQueued(
  msg: readonly MsgQueued[],
  cmd: readonly CmdQueued[],
  projectId: string
): QueuedEntry[] {
  const out: QueuedEntry[] = []
  for (const m of msg) {
    if (m.project === projectId) out.push({ qid: m.qid, kind: 'msg', text: m.raw, project: m.project })
  }
  for (const c of cmd) {
    if (c.projectId === projectId) out.push({ qid: c.qid, kind: 'cmd', text: c.raw, project: c.projectId })
  }
  return out
}

/** 按 qid 从队列中移除（原地 splice），返回被移除条目；未命中返回 undefined */
export function removeQueuedByQid<T extends { qid: string }>(arr: T[], qid: string): T | undefined {
  const i = arr.findIndex((x) => x.qid === qid)
  if (i < 0) return undefined
  return arr.splice(i, 1)[0]
}

/** 队列条目唯一 id（会话内 refs，非持久化） */
export function newQid(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

/**
 * 取回排版（2026-10-02 体验层候选 1「排队条目取回/编辑」；Claude Code「Take back what you queued」：
 * 「puts them in the input box, one per line, ahead of any text you had typed」——取回文本放在
 * 作者在途输入之前、各占一行）。输入框为空=直接放入；非空=取回文本换行前置（不覆盖在途草稿）。
 */
export function composeTakeBackInput(existing: string, taken: string): string {
  if (!existing.trim()) return taken
  return taken + '\n' + existing
}
