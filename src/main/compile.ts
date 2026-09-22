// ===== 织卷 V2 · 作品编译（主进程侧：收集 + 拼装 + 落盘前置） =====
// 与 store.listChapters 同口径收集（文件名「第N章」序 / front matter 解析 / shared/chapters.ts 单源），
// 线名用 chapterLine（shared/line.ts）归一后给 compileNovel（shared/compile.ts 纯函数）。
// 本模块不碰对话框（对话框在 ipc.ts router 内，与 chapter:export 同模式）。

import { join } from 'path'
import { listChapters, readDoc } from './store'
import { chapterLine } from '../shared/line'
import { compileNovel, chapterBodyOf, type CompileChapterInput } from '../shared/compile'

export type CompiledBody =
  | { ok: true; body: string; chapters: number }
  | { ok: false; error: string }

/** 整书合并正文（只读，不落盘）：章序 = 编辑器同口径（file「第N章」序）；空项目 → body '' + chapters 0 */
export function buildCompiledBody(projectId: string): CompiledBody {
  try {
    const entries = listChapters(projectId)
    const inputs: CompileChapterInput[] = entries.map((e) => ({
      name: e.name,
      text: readDoc(projectId, join('正文', e.file)) ?? '',
      line: chapterLine(e.fm)
    }))
    const body = compileNovel(inputs)
    // 章数 = 实际产出（空章跳过，与 compileNovel 同口径）
    const chapters = inputs.filter((c) => chapterBodyOf(c.text)).length
    return { ok: true, body, chapters }
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
}
