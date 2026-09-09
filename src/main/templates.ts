// ===== 织卷 V2 · 项目模板（模块设计 §四 新建项目 / M3 项目模板 v1） =====
// 模板＝纯文件目录（<工作区>/模板/项目模板/<模板名>/），与项目内结构同构；
// 新建项目时可把它当作「初始内容」：把模板里的文档补充复制进新项目（不覆盖已有文件）。
// 设计依据（平台层档案 2026-09-09 第 2 轮）：学 Obsidian「模板＝目录下的文件」，不做 Scrivener 式项目快照导入导出。
import { join, dirname } from 'path'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
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
const SAMPLE_FILES: Record<string, string> = {
  '人物/示例角色.md': `# 示例角色

> 一句话定位：这里是角色档案的示例——每个主要角色一个文件、放在 人物/ 下。

## 基础设定（不变项）

- 姓名：示例角色
- 身份：（身份 / 职业）
- 外貌：（关键外貌特征）
- 性格：（性格要点）
- 背景：（与故事相关的过往）

## 切片：示例切片_初遇

（本切片的角色状态：在场 / 关系 / 身体与心理状态 / 知晓的信息。正文保存后，写作引擎会按章把变化写进对应切片的这个小节。）
`,
  '世界观/切片_示例切片_初遇.md': `# 世界观 · 切片：示例切片_初遇

> 每个时间切片的世界状态一个文件（\`世界观/切片_<切片名>.md\`），正文保存后随切片同步更新。
> 长期不变的世界设定写在 \`世界观/总纲.md\`，不要写到这里。

## 本切片时间点

（这一片段的时代背景、地点、社会状态）

## 新揭示的规则 / 事件

（正文里出现了什么新设定线索，留待后续展开）
`,
  '正文/第01章_示例.md': `---
章号: 1
题名: 示例章
切片: 示例切片_初遇
涉及人物: [示例角色]
---

这里是正文章节的示例：每章一个文件（\`正文/第NN章_题名.md\`），章首那段 front matter 是本项目的约定头——\`切片\` 是本章的时间切片名，\`涉及人物\` 是该章出场角色，切片同步靠它们定位。

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
      writeFileSync(f, content, 'utf-8')
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
          writeFileSync(dest, readFileSync(p, 'utf-8'), 'utf-8')
          copied.push(r)
        }
      }
    }
  }
  walk(src, '')
  return { ok: true, copied }
}
