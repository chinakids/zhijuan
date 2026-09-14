// ===== 织卷 · 相对项目根路径的跨平台拼接（shared 纯约定，无 fs / 无 node 内置）=====
// 动机（2026-09-14 平台层 Windows 兼容走查，docs/平台层-走向win-走查.md）：
// 主进程枚举目录树时用原生 path.join 拼「相对路径」会在 Windows 产出反斜杠（path.relative 同理），
// 而渲染层与 devShim 的 IPC 契约全部是正斜杠（'目录/' + d.file、useFsChanged 前缀匹配、split('/')）。
// mac 上 path.join 恰好产出 '/'，掩盖了该差异；一旦 win 启用，DocSection/Outline/CollectionBar 等
// 拼出的混合路径会让 readDoc/deleteDoc 全部失效。本函数固定产出 '/'，任何平台一致。
// 语义与 path.posix.join 等价（此处仅用于 readdir 递归 prefix，无 '..' / '.' 需要规范化）。

/** 拼接相对路径：prefix 为空 → name；否则 prefix + '/' + name（恒正斜杠）。 */
export function posixRel(prefix: string, name: string): string {
  return prefix ? prefix + '/' + name : name
}

/** 把平台分隔符归一为正斜杠（用于 path.relative 等平台 API 的输出，如 FsEvent.path）。 */
export function toPosix(p: string): string {
  return p.split('\\').join('/')
}
