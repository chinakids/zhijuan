import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

const toPosix = (p: string): string => p.split(sep).join('/')

/** 取真实路径（best-effort：文件/目录被删时返回 null） */
function tryReal(p: string): string | null {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

/**
 * 归一化 fs.watch 回调里的 filename，得到「相对项目根」的 posix 路径。
 *
 * 为什么不能直接 `relative(root, filename)`（2026-10-29 真机 bug，F-20261029-01）：
 * macOS 上 `watch(root, { recursive: true })` 回调给的是**相对 root 的路径**（如 `正文/第01章.md`），
 * 不是绝对路径。直接 relative(root, '正文/第01章.md') 会把它当成「相对 cwd」→ 得到
 * `../../../../Desktop/织卷/正文/第01章.md`。渲染层按 `e.path === '正文/' + sel` 匹配，
 * 于是**外部写盘（agent 采纳/外部编辑）永远匹配不上 → 编辑器不实时刷新**，只能关掉重开。
 * 无头冒烟走 devShim 的模拟事件（路径是干净相对路径），所以一直没暴露。
 *
 * 规则：
 *  - 绝对路径（部分平台/版本给绝对）→ 相对 root（root 与 realpath(root) 都试，避开符号链接/libuv 归一化差异）
 *  - 相对路径 → 本身就是 root 相对，直接归一化 psx
 *  - 归一化后越界（`..` 开头）或为空 → 返回 ''（调用方丢弃）
 */
export function watchRelPath(root: string, filename: string): string {
  const raw = String(filename ?? '')
  if (!raw) return ''
  let rel: string
  if (isAbsolute(raw)) {
    rel = ''
    const bases = [root]
    const realRoot = tryReal(root)
    if (realRoot && realRoot !== root) bases.push(realRoot)
    for (const base of bases) {
      const cand = toPosix(relative(base, raw))
      if (cand && cand !== '..' && !cand.startsWith('../')) {
        rel = cand
        break
      }
    }
    if (!rel) return ''
  } else {
    rel = toPosix(raw)
  }
  rel = rel.replace(/^\.\//, '')
  if (!rel || rel === '..' || rel.startsWith('../')) return ''
  return rel
}