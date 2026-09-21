// ===== 织卷 V2 · 项目模板（模块设计 §四 新建项目 / M3 项目模板 v1） =====
// 模板＝纯文件目录（<工作区>/模板/项目模板/<模板名>/），与项目内结构同构；
// 新建项目时可把它当作「初始内容」：把模板里的文档补充复制进新项目（不覆盖已有文件）。
// 设计依据（平台层档案 2026-09-09 第 2 轮）：学 Obsidian「模板＝目录下的文件」，不做 Scrivener 式项目快照导入导出。
import { join, dirname } from 'path'
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { workspaceDir } from './settings'
import { PROJ_FILE, DOT_DIR } from '../shared/paths'
import type { ProjectTemplate } from '../shared/types'

/** 模板根目录（工作区下，相对） */
export const TEMPLATES_DIR = '模板/项目模板'
/** 内建「示例」模板名 */
export const BUILTIN_SAMPLE = '示例'

function templatesRoot(): string {
  return join(workspaceDir(), TEMPLATES_DIR)
}

// ---------- 内建「示例」模板（幂等落档：只落空档，不覆盖用户改动；同 文档/ 模式） ----------
// 口径（2026-09-11 创作层）：模板占位说明一律用 HTML 注释（同 ProjectGuide.charDoc 引导建档式），
// 不再预置「## 切片：示例切片_初遇」这类真实小节/占位内容——切片小节由引擎在正文保存时按「切片名」
// 自然生成；预置死节会在真实切片名下永不清理，且随人物档全文件进 agent 上下文污染提示词。
// 世界切片文件与运行时 ensureWorldSliceFile 生成形态同构（H1「# 切片：<名>」+ 固定说明行），
// 保证 isTemplateShell 判空壳、锚点精确匹配都能命中同一形态。
const SAMPLE_FILES: Record<string, string> = {
  '人物/示例角色.md': `# 示例角色

> 一句话定位：这里是人物档案的示例——每个主要人物一个文件、放在 人物/ 下。
> 若 TA 在正文里还有别的称呼（昵称/化名），把「别名: [小七, 七爷]」写进本文件顶部 front matter，「在场/称谓」机械检查会按它识别。

## 基础设定（不变项）

- 姓名：示例角色
- 身份：（身份 / 职业）
- 外貌：（关键外貌特征）
- 性格：（性格要点）
- 背景：（与故事相关的过往）

<!-- 正文保存后，切片同步会把 TA 在本章的新状态写入「## 切片：<切片名>」小节（没有则自动追加到文件末尾）；上面「基础设定」是长期不变项，请手动维护，勿与切片小节混写。 -->
`,
  '世界观/切片_示例切片_初遇.md': `# 切片：示例切片_初遇

> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。

<!-- 这是时间切片文件的骨架（与项目运行时自动生成的形态同构）：正文保存后，切片同步会把本章揭示的世界新状态按「切片名」写入本文件；可在文件里按需组织小节，如「## 本切片时间点」「## 新揭示的规则/事件」。 -->
`,
  '正文/第01章_示例.md': `---
章号: 1
题名: 示例章
切片: 示例切片_初遇
涉及人物: [示例角色]
---

这里是正文章节的示例：每章一个文件（\`正文/第NN章_题名.md\`），章首那段 front matter 是本项目的约定头——\`切片\` 是本章的时间切片名，\`涉及人物\` 是该章出场人物，切片同步靠它们定位。

（把这段示例改成你自己的故事，或直接删除这一章。示例文档删掉后不会自己长回来。）
`
}

export function ensureBuiltinTemplates(): string[] {
  const root = templatesRoot()
  const created: string[] = []
  for (const [rel, content] of Object.entries(SAMPLE_FILES)) {
    const f = join(root, BUILTIN_SAMPLE, rel)
    if (!existsSync(f)) {
      mkdirSync(dirname(f), { recursive: true })
      writeFileAtomic(f, content)
      created.push(rel)
    }
  }
  return created
}

/** 模板列表：先确保内建「示例」落档，再扫描模板目录（用户自定义模板＝往目录里放文件夹） */
export function listTemplates(): ProjectTemplate[] {
  ensureBuiltinTemplates()
  const root = templatesRoot()
  if (!existsSync(root)) return []
  const out: ProjectTemplate[] = []
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    out.push({ id: e.name, name: e.name, builtin: e.name === BUILTIN_SAMPLE })
  }
  return out.sort((a, b) => (a.builtin ? -1 : 1) - (b.builtin ? -1 : 1) || a.name.localeCompare(b.name, 'zh'))
}

/**
 * 把模板内容「补充复制」进新项目：只复制 .md、跳过已存在文件、跳过 project.md 与 .zhijuan/
 * （模板目录里不该有它们，防御性跳过）。返回实际复制了哪些相对路径。
 */
export function applyTemplate(id: string, targetRoot: string): { ok: boolean; copied: string[]; error?: string } {
  ensureBuiltinTemplates() // 内建「示例」始终可用（幂等；用户模板目录不受影响）
  const src = join(templatesRoot(), id)
  if (!existsSync(src)) return { ok: false, copied: [], error: `模板不存在：${id}` }
  const copied: string[] = []
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === DOT_DIR) continue
      const p = join(dir, e.name)
      const r = rel ? join(rel, e.name) : e.name
      if (e.isDirectory()) {
        walk(p, r)
      } else if (e.name.endsWith('.md') && r !== PROJ_FILE) {
        const dest = join(targetRoot, r)
        if (!existsSync(dest)) {
          mkdirSync(dirname(dest), { recursive: true })
          writeFileAtomic(dest, readFileSync(p, 'utf-8'))
          copied.push(r)
        }
      }
    }
  }
  walk(src, '')
  return { ok: true, copied }
}
