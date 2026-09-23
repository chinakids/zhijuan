// ===== 织卷 V2 · 作品编译 Word 导出（mac textutil 桥；模块设计 §四 A 扩展 v1.1） =====
// 产品：成品交付常见需求=Word（投稿/编辑/打印）。零依赖路径＝mdToHtml（shared/compile.ts 纯函数）
// → mac 系统内置 textutil（Cocoa 文本系统）html→docx：本机实证（2026-09-24 01:30 平台层轮，
// 产物 OOXML 合法）；不改旧结论「docx 需 pandoc=不引」的工程红线——textutil 本身就是系统内置，
// 非新依赖。win/linux 无 textutil → 优雅报错回退 Markdown（win 打包本已延后）。
// 本模块只做「md→docx 单文件转换」，对话框/读盘在 ipc.ts（与 chapter:export/compileExport 同模式）。

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mdToHtml } from '../shared/compile'

export interface DocxExportResult {
  ok: boolean
  error?: string
}

/** textutil 只在 macOS 存在（win/linux 优雅回退） */
export function docxAvailable(): boolean {
  const r = spawnSync('which', ['textutil'], { encoding: 'utf8' })
  return r.status === 0 && r.stdout.trim().length > 0
}

/**
 * md→docx：mdToHtml → 临时 html → `textutil -convert docx -output <outPath>` → 清理临时目录。
 * 失败（textutil 缺失/非零退出）返回 { ok:false, error }，不动 outPath（调用方按错误提示）。
 */
export function exportDocx(md: string, outPath: string): DocxExportResult {
  if (!docxAvailable()) {
    return { ok: false, error: 'Word 导出需要 macOS 自带的 textutil（当前系统未找到），请改用合并 Markdown 导出' }
  }
  const html = mdToHtml(md)
  if (!html.trim()) {
    return { ok: false, error: '没有可导出的正文' }
  }
  const dir = mkdtempSync(join(tmpdir(), 'zj-docx-'))
  const tmpHtml = join(dir, 'doc.html')
  writeFileSync(tmpHtml, html, 'utf8')
  try {
    const r = spawnSync('textutil', ['-convert', 'docx', '-output', outPath, tmpHtml], { encoding: 'utf8' })
    if (r.error) return { ok: false, error: `textutil 调用失败：${String(r.error.message ?? r.error)}` }
    if (r.status !== 0) {
      const msg = (r.stderr || r.stdout || '转换失败').trim()
      return { ok: false, error: `Word 转换失败：${msg}` }
    }
    return { ok: true }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
