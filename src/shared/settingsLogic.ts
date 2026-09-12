// ===== 织卷 · 设置路径决策（共享纯函数，2026-09-12 第 19 轮） =====
// 库根默认位的决策链：真机 settings.libraryRoot（fs 感知老默认位是否存在）与 devShim
// （浏览器 mock，无 fs、以常量模拟本机实况）共用，防止两侧在「默认位」上分叉——
// 本轮实锤：本机 ~/Documents/织卷项目库 存在且非空，真机默认走老默认位，mock 却显示工作区/项目库。
export interface LibraryRootChoice {
  /** 设置里的显式库根（可空） */
  configured: string | null | undefined
  /** 老默认位（文档/织卷项目库）——仅当 legacyExists 时有意义 */
  legacyPath: string
  /** 工作区根（文档/织卷工作区；与「项目库」拼成 工作区/项目库 默认位） */
  workspaceDefault: string
  /** 老默认位是否存在且非空（真机=existsSync + readdirSync>0；dev=常量模拟本机实况） */
  legacyExists: boolean
}

/** 生效库根：设置非空优先；否则老默认位（存在且非空）保持原地（D-V2-8）；再落 工作区/项目库 */
export function resolveLibraryRoot(o: LibraryRootChoice): string {
  if (o.configured && o.configured.trim()) return o.configured.trim()
  if (o.legacyExists) return o.legacyPath
  const ws = o.workspaceDefault.endsWith('/') ? o.workspaceDefault.slice(0, -1) : o.workspaceDefault
  return ws + '/项目库'
}
