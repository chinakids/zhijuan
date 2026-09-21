// ===== 织卷 V2 · 工作区外壳数据（模块设计 §五 模块 B：工作区/文档 说明） =====
// 从 fileStore 拆出：store 只留「项目 + 文件 + watcher」（见 docs/架构评审与调整-2026-09-04.md §二-1）。
// 职责：工作区初始化落档说明文档（<工作区>/文档/，幂等）与查询；路径决策在 settings.ts。
import { join, basename } from 'path'
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { workspaceDir } from './settings'
import { WORKSPACE_DOCS } from './workspace-docs'

// ---------- 工作区文档（落档在 <工作区>/文档/，幂等） ----------
export function workspaceStatus(): { dir: string; inited: boolean; docs: { file: string; name: string }[] } {
  return { dir: workspaceDir(), inited: existsSync(join(workspaceDir(), '文档')), docs: listWorkspaceDocs() }
}

export function ensureWorkspaceDocs(): { ok: boolean; created: string[]; docs: string[] } {
  const ws = workspaceDir()
  const docDir = join(ws, '文档')
  mkdirSync(docDir, { recursive: true })
  mkdirSync(join(ws, '项目库'), { recursive: true })
  const created: string[] = []
  for (const [name, content] of Object.entries(WORKSPACE_DOCS)) {
    const f = join(docDir, name)
    if (!existsSync(f)) {
      writeFileAtomic(f, content)
      created.push(name)
    }
  }
  return { ok: true, created, docs: Object.keys(WORKSPACE_DOCS) }
}

export function listWorkspaceDocs(): { file: string; name: string }[] {
  const docDir = join(workspaceDir(), '文档')
  if (!existsSync(docDir)) return []
  return readdirSync(docDir, { withFileTypes: true })
    .filter((x) => x.isFile() && x.name.endsWith('.md'))
    .map((x) => ({ file: x.name, name: x.name.replace(/\.md$/, '') }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export function readWorkspaceDoc(file: string): string | null {
  const safe = basename(file)
  const f = join(workspaceDir(), '文档', safe)
  if (!existsSync(f)) return null
  return readFileSync(f, 'utf-8')
}
