/**
 * 提案 apply 失败分类（2026-09-16 创作层候选 1「提案失败卡就地重试评估」落地的判定权威源）。
 *
 * 调研结论（UX Patterns Guide 原文实抓，2026-09-16）：
 * - change-review 模式：「A stale or outdated change cannot be applied silently; the user must
 *   refresh, re-review, or resolve conflict.」——内容/锚点漂移是**确定性失败**，重放同一载荷
 *   必然再败，正确处置=刷新重新生成（织卷对应：重新扫描批注/再次保存），保持 rejected 不可重试；
 * - regenerate / retry vs editable AI output 对比页：「Render regenerate / retry as a
 *   response-level control that names whether it will rerun the same prompt… or retry failed
 *   tool and source work.」——含糊的 Try again（不区分重放/重新生成）是 bad UI；重试只应
 *   提供给**可能因重放而成功**的失败（瞬态/系统错误），并言明语义。
 *
 * 落地：把失败分成两类，处置不同——
 * - **内容校验失败**（before 漂移 / 缺 before / 锚点不匹配）：确定性，保持 rejected；
 * - **系统 / IO 失败**（EACCES / EISDIR / ENOSPC / 路径冲突等 Node fs 带 code 的错误）：
 *   瞬态且与内容无关，**保持 pending**——pending 卡「接受」按钮天然可用，作者可就地重试，
 *   无需新增 failed 状态（提案状态机/类型/devShim/冒烟零扩容）。
 *
 * 主进程 proposals.ts applyProposal 与渲染层 devShim 同口径使用本函数。
 */
export function isIoFailure(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  // Node fs/系统错误带 code（EACCES/EISDIR/ENOSPC/EPIPE…）；业务校验错误（applyAnchor 手动 new Error）无 code
  const code = (e as { code?: unknown }).code
  return typeof code === 'string' && code.length > 0
}
