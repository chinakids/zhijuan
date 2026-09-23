// ===== 织卷 V2 · 作品编译 EPUB 导出（mac zip 桥；模块设计 §四 A 扩展 v1.2） =====
// 产品：成品交付第三出口=EPUB 电子书（校对/分发/阅读器）。零依赖路径：buildEpubFiles
// （shared/epub.ts 纯函数，生成 zip 条目）→ 系统 /usr/bin/zip 打包为 EPUB3 容器——
//   `zip -X0` 首发 mimetype（STORED、无 extra field，OCF 无障碍读取）＋ `zip -Xr` 其余
//   （2026-09-24 04:30 平台层轮实证：mac 内置 zip 可产合法 EPUB3，python3 zipfile 逐条
//   校验通过；W3C EPUB 3.3 依据见 shared/epub.ts 头注）。win/linux 无等价内置 →
//   优雅报错回退 Markdown（win 打包本已延后）。
// 本模块只做「zip 条目→.epub 文件」打包；对话框/读盘在 ipc.ts（与 compileExport 同模式）。

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEpubFiles, type EpubBuildOptions } from '../shared/epub'
import type { CompileChapterInput } from '../shared/compile'

export interface EpubExportResult {
  ok: boolean
  error?: string
}

/** /usr/bin/zip 只在 macOS 存在（win/linux 优雅回退） */
export function zipAvailable(): boolean {
  const r = spawnSync('which', ['zip'], { encoding: 'utf8' })
  return r.status === 0 && r.stdout.trim().length > 0
}

/**
 * chrome→epub：buildEpubFiles → 临时目录写条目 → `zip -X0`（mimetype 首发 stored）
 * ＋ `zip -Xr`（其余条目）→ 清理临时目录。失败（zip 缺失/非零退出）返回 { ok:false, error }。
 * 输出文件若已存在先删除（zip 对已存在目标做「更新」而非「新建」，会残留旧条目=坏包）。
 */
export function exportEpub(
  chapters: CompileChapterInput[],
  projectTitle: string,
  outPath: string
): EpubExportResult {
  if (!zipAvailable()) {
    return { ok: false, error: 'EPUB 导出需要系统自带的 zip 命令（macOS 内置；当前系统未找到），请改用合并 Markdown 导出' }
  }
  const opts: EpubBuildOptions = { projectTitle, identifier: `urn:uuid:${randomUUID()}` }
  const files = buildEpubFiles(chapters, opts)
  if (files.length === 0) {
    return { ok: false, error: '没有可导出的正文' }
  }
  const dir = mkdtempSync(join(tmpdir(), 'zj-epub-'))
  try {
    for (const f of files) {
      const p = join(dir, ...f.name.split('/'))
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, f.content, 'utf8')
    }
    rmSync(outPath, { force: true })
    // 首条目 mimetype 必须 STORED 且无 extra field（-X0 的顺序=文件自然序，mimetype 先写即在首）
    const first = spawnSync('zip', ['-X0', outPath, 'mimetype'], { cwd: dir, encoding: 'utf8' })
    if (first.error) return { ok: false, error: `zip 调用失败：${String(first.error.message ?? first.error)}` }
    if (first.status !== 0) return { ok: false, error: `zip 打包失败：${(first.stderr || first.stdout || '').trim() || 'mimetype 条目出错'}` }
    const rest = spawnSync('zip', ['-Xr', outPath, 'META-INF', 'OEBPS'], { cwd: dir, encoding: 'utf8' })
    if (rest.error) return { ok: false, error: `zip 调用失败：${String(rest.error.message ?? rest.error)}` }
    if (rest.status !== 0) return { ok: false, error: `zip 打包失败：${(rest.stderr || rest.stdout || '').trim() || '内容条目出错'}` }
    if (!existsSync(outPath)) return { ok: false, error: '产物未生成（zip 未写盘）' }
    return { ok: true }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
