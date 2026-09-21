import { renameSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'

/**
 * 原子写文件：先把内容写入同目录临时文件，再 rename 覆盖目标。
 * 观测者（云同步守护进程 / watcher / 崩溃恢复）只会见到完整旧文件或完整新文件，
 * 不会读到 writeFileSync 直写中段的半写内容——本地优先写作应用的数据底线
 * （参考 npm write-file-atomic：temp 写入 + rename + 失败清理 temp）。
 * - 临时文件与目标同目录（跨文件系统 rename 不原子）；命名含 pid+序号，进程内并发不可撞名
 * - 写失败/rename 失败时尽力清理临时文件后原样抛出（不吞错误）
 * - 目录必须已存在（与 writeFileSync 语义一致，调用方负责 ensure/mkdir）
 * - 不处理权限位继承（本项目文件均为此应用创建，默认 0644）
 */
export function writeFileAtomic(file: string, content: string): void {
  const dir = dirname(file)
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${atomSeq++}.tmp`)
  try {
    writeFileSync(tmp, content, 'utf-8')
    renameSync(tmp, file)
  } catch (e) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 清理 best-effort */
    }
    throw e
  }
}

let atomSeq = 0
