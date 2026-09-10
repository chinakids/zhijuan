// ===== 织卷 V2 · IPC 路由（renderer 唯一入口） =====
import { ipcMain, shell, BrowserWindow } from 'electron'
import type { AppSettings, FsEvent, ProposalItem, EditItem } from '../shared/types'
import { adoptActsChapter } from '../shared/actsAdopt'
import { countWords } from '../shared/count'
import { listProposals, createProposals, applyProposal, rejectProposal } from './proposals'
import { listSlices } from './slices'
import { listSnapshots, readSnapshot } from './history'
import { registerAgentIpc } from './agent/ipc'
import { runChapterUnlisted } from './agent/audit'
import { isRuntimeCreated, closeHarness } from './agent/runtime'
import { getSettings, setSettings, libraryRoot } from './settings'
import {
  listProjects,
  createProject,
  removeProject,
  importProject,
  projectDir,
  readDoc,
  writeDoc,
  listDocs,
  listChapters,
  watchProject
} from './store'
import { workspaceStatus, ensureWorkspaceDocs, readWorkspaceDoc } from './workspace'
import { listLibraryCategories, createLibraryCategory, searchDocs } from './library'
import { listTemplates } from './templates'
import { workspaceDir } from './settings'

export function broadcastToAll(evt: FsEvent) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('fs:event', evt)
  }
}

export function registerIpc() {
  // 首次启动自动把说明文档落进工作区（幂等；设置按钮可手动补）
  ensureWorkspaceDocs()
  // 设置
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const next = setSettings(patch)
    // 模型服务商、工具集变了：关掉写作引擎，下次请求按新设置重建
    if (isRuntimeCreated() && (patch.llm || patch.agentTools)) {
      void closeHarness()
    }
    return next
  })

  // 项目
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:create', (_e, name: string, description: string, template?: string) => createProject(name, description, template))
  ipcMain.handle('project:templates', () => listTemplates())
  ipcMain.handle('project:remove', (_e, id: string) => removeProject(id))
  ipcMain.handle('project:import', (_e, dir: string) => importProject(dir))
  ipcMain.handle('project:reveal', (_e, id: string) => {
    shell.showItemInFolder(projectDir(id))
  })
  ipcMain.handle('project:open', (_e, id: string) => {
    watchProject(id, (evt) => broadcastToAll(evt))
    return true
  })
  ipcMain.handle('app:getPaths', () => ({
    documents: libraryRoot(),
    defaultLibrary: shell ? String(process.env.HOME) : ''
  }))

  // 工作区（设置里的工作区 = 织卷根目录；相关文档落档在 工作区/文档/）
  ipcMain.handle('workspace:status', () => workspaceStatus())
  ipcMain.handle('workspace:init', () => ensureWorkspaceDocs())
  ipcMain.handle('workspace:read', (_e, file: string) => readWorkspaceDoc(file))

  // 文档（相对项目根）
  ipcMain.handle('doc:read', (_e, id: string, rel: string) => readDoc(id, rel))
  ipcMain.handle('doc:write', (_e, id: string, rel: string, content: string) => {
    writeDoc(id, rel, content)
    return true
  })
  // 采纳 agent 的正文修改：按 find 在原文档里唯一替换（读取当前磁盘内容为准），落地后走正常 fs 事件让编辑器静默重载
  ipcMain.handle('doc:applyEdit', (_e, id: string, rel: string, edits: EditItem[]) => {
    const cur = readDoc(id, rel)
    if (cur === null) return { ok: false, errors: ['文档已不存在'] }
    let next = cur
    const errors: string[] = []
    for (const ed of edits) {
      const find = ed.find
      if (!find) { errors.push('条目缺少 find'); continue }
      const i = next.indexOf(find)
      if (i < 0) { errors.push(`未找到原文「${find.slice(0, 24)}…」`); continue }
      if (next.indexOf(find, i + 1) >= 0) { errors.push(`「${find.slice(0, 24)}…」在文档中不只一处，未应用`); continue }
      next = next.slice(0, i) + ed.replace + next.slice(i + find.length)
    }
    if (errors.length) return { ok: false, errors }
    writeDoc(id, rel, next)
    return { ok: true }
  })
  // 采纳「分幕草稿」为本章正文：保留本章原约定头与题名，正文主体换成分幕草稿段落（草稿本身保留）
  ipcMain.handle('doc:adoptActs', (_e, id: string, chapterRel: string, draftRel: string) => {
    const cur = readDoc(id, chapterRel)
    if (cur === null) return { ok: false, error: '章节正文已不存在' }
    const draft = readDoc(id, draftRel)
    if (draft === null) return { ok: false, error: '分幕草稿已不存在' }
    const name = chapterRel.replace(/^正文\//, '').replace(/\.md$/, '')
    const r = adoptActsChapter(cur, draft, name)
    if ('error' in r) return { ok: false, error: r.error }
    writeDoc(id, chapterRel, r.next)
    return { ok: true, words: countWords(r.body) }
  })
  ipcMain.handle('doc:list', (_e, id: string, relDir: string) => listDocs(id, relDir))
  ipcMain.handle('chapter:list', (_e, id: string) => listChapters(id))

  // 素材库域（模块设计 §九：类别树 / 新建类别 / 文件名+全文搜索）
  ipcMain.handle('library:categories', (_e, id: string) => listLibraryCategories(id))
  ipcMain.handle('library:createCategory', (_e, id: string, name: string) => createLibraryCategory(id, name))
  ipcMain.handle(
    'docs:search',
    (_e, id: string, relDir: string, query: string, opts?: { excludePrefix?: string[]; limit?: number }) =>
      searchDocs(id, relDir, query, opts)
  )

  // 正文版本历史（M3）：列表 + 读单版；恢复 = 读版后走 doc:write（自动再留一版，天然可反悔）
  ipcMain.handle('history:list', (_e, id: string, rel: string) => listSnapshots(projectDir(id), rel))
  ipcMain.handle('history:read', (_e, id: string, rel: string, name: string) => readSnapshot(projectDir(id), rel, name))

  // 时间线（切片清单，E4）
  ipcMain.handle('slices:list', (_e, projectId: string) => listSlices(projectDir(projectId)))

  // 保存正文前置快检（本地规则，与 presence 同口径）：单章「名单外出场」命中（零模型）
  ipcMain.handle('presence:chapterUnlisted', (_e, id: string, chapterRel: string) => runChapterUnlisted(id, chapterRel))

  // 提案（S4）
  ipcMain.handle('proposal:list', (_e, id: string) => listProposals(libraryRoot(), id))
  ipcMain.handle('proposal:create', (_e, id: string, source: 'slice-sync' | 'agent-chat', chapter: string, slice: string, items: ProposalItem[]) => createProposals(libraryRoot(), id, source, chapter, slice, items))
  ipcMain.handle('proposal:apply', (_e, id: string, pid: string) => applyProposal(libraryRoot(), id, pid))
  ipcMain.handle('proposal:reject', (_e, id: string, pid: string) => rejectProposal(libraryRoot(), id, pid))

  // agent（dsh 写作引擎）
  registerAgentIpc()
}
