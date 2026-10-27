// ===== 未保存守卫 · 纯逻辑（2026-10-27 体验层：正文页之外的三处编辑器宿主共用）=====
// 背景：Novel 页早有三套守卫（切章 / 关窗 beforeunload / 路由 useBlocker），但 人物·世界观（DocSection）、
// 素材库（LibraryBrowser）、大纲（Outline）三处 DocEditor 宿主都没有——切文档、返回列表、离开大纲页
// 会静默丢稿。本文件把守卫里「不依赖 React 的判定」抽出来，三处宿主走同一份文案与语义，
// 避免三套复制各自漂移；纯函数/纯队列便于 node 环境单测（tests/unit/unsavedGuard.test.ts）。
//
// 文案与判定口径照抄 Novel.tsx 现有三处守卫（2026-09-23 切章 / 2026-09-24 关窗+路由）：
// 标题统一「有未保存的改动」，三选=取消 / 不保存X / 保存并X；只有明确落盘才算「可以走」。

/** 离开场景：切文档 / 离开页面（路由）/ 关闭窗口 */
export type LeaveReason = 'switch' | 'leave' | 'close'
/** 三选结果 */
export type LeaveChoice = 'save' | 'discard' | 'cancel'

export interface LeaveCopy {
  title: string
  description: string
  saveLabel: string
  discardLabel: string
}

const COPY: Record<LeaveReason, { after: string; save: string; discard: string }> = {
  switch: { after: '切换后将丢失。', save: '保存并切换', discard: '不保存切换' },
  leave: { after: '离开后将丢失。', save: '保存并离开', discard: '不保存离开' },
  close: { after: '关闭窗口后将丢失。', save: '保存并关闭', discard: '不保存关闭' }
}

/** 三选确认文案：与 Novel 切章/关窗/路由守卫同句同调，只把「当前章节」换成宿主主语 */
export function leaveCopy(reason: LeaveReason, subject = '当前文档'): LeaveCopy {
  const c = COPY[reason]
  return {
    title: '有未保存的改动',
    description: `${subject}有未保存的内容，${c.after}`,
    saveLabel: c.save,
    discardLabel: c.discard
  }
}

/**
 * 保存结果归一（Novel 同口径）：DocEditor 的 doSave 返回 true 才算落盘——
 * 空写防线拦截 / IO 失败 / 编辑器未就绪（undefined）都算「没保存成功」，调用方须留在原地不丢内容。
 */
export async function runLeaveChoice(
  choice: LeaveChoice,
  doSave?: () => Promise<boolean> | boolean
): Promise<boolean> {
  if (choice === 'cancel') return false
  if (choice === 'discard') return true
  if (!doSave) return false
  try {
    return (await doSave()) === true
  } catch {
    return false
  }
}

/** beforeunload 是否要拦：已确认关闭（放行）或没有改动时零打扰 */
export function shouldBlockUnload(dirty: boolean, closeConfirmed: boolean): boolean {
  return dirty && !closeConfirmed
}

/**
 * 待决队列：把「弹窗三选」变成可 await 的 Promise。
 * 同一时刻只允许一个待决请求——新的 ask 会把旧的按「取消」结算（防宿主连点导致 Promise 永悬）。
 * 路由级守卫（useBlocker）不需要 Promise，直接走 settle 的幂等路径。
 */
export function createLeaveQueue() {
  let resolveFn: ((ok: boolean) => void) | null = null
  return {
    ask(): Promise<boolean> {
      resolveFn?.(false)
      return new Promise<boolean>((resolve) => {
        resolveFn = resolve
      })
    },
    /** 结算当前待决请求（无待决时是空操作；重复结算只生效一次） */
    settle(ok: boolean): void {
      const fn = resolveFn
      resolveFn = null
      fn?.(ok)
    },
    get pending(): boolean {
      return resolveFn !== null
    }
  }
}

export type LeaveQueue = ReturnType<typeof createLeaveQueue>