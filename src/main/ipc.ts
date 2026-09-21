// ===== 织卷 V2 · IPC 路由（renderer 唯一入口） =====
import { ipcMain, shell, BrowserWindow, dialog, app } from 'electron'
import { readFileSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { join } from 'path'
import type { AppSettings, FsEvent, ProposalItem, EditItem, Proposal, SaveTraceEntry } from '../shared/types'
import { adoptActsChapter } from '../shared/actsAdopt'
import { countWords } from '../shared/count'
import { extractFrontMatter } from '../shared/fmatter'
import { listProposals, createProposals, createSliceProposals, applyProposal, rejectProposal, discardProposal } from './proposals'
import { listLines, listSlices } from './slices'
import { listSnapshots, readSnapshot } from './history'
import { registerAgentIpc } from './agent/ipc'
import { runChapterUnlisted, runChapterMissing } from './agent/audit'
import { scanAnnotations, resolveAnnotationRows, addAnnotation, listAnnotations, removeAnnotation } from './agent/annotations'
import { isRuntimeCreated, closeHarness } from './agent/runtime'
import { getSettings, setSettings, libraryRoot } from './settings'
import { getRecentEntries, recordOpen, removeRecent } from './recent'
import {
  listProjects,
  createProject,
  removeProject,
  importProject,
  exportProject,
  projectDir,
  readDoc,
  writeDoc,
  deleteDoc,
  listDocs,
  listChapters,
  renameChapter,
  editChapterSlice,
  deleteChapter,
  watchProject
} from './store'
import { workspaceStatus, ensureWorkspaceDocs, readWorkspaceDoc } from './workspace'
import { appendSaveTrace } from './saveTrace'
import { runWritingInsights } from './writingInsights'
import { listLibraryCategories, createLibraryCategory, searchDocs, recentLibraryDocs } from './library'
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
  // 首页「更改库根路径」（模块设计 §四 A「库根路径（可改）」）：选目录 → 写入设置 → 返回新生效库根
  ipcMain.handle('settings:pickLibrary', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择项目库位置（作品将保存在该目录）',
      buttonLabel: '更改到此位置',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    setSettings({ libraryRoot: r.filePaths[0] })
    return libraryRoot()
  })
  // 设置页「自定义用词词表」：导入 / 导出 .txt（每行一条短语；系统文件对话框，与 chapter:export 同范式）
  ipcMain.handle('settings:importOveruseTxt', async () => {
    const r = await dialog.showOpenDialog({
      title: '导入用词词表（.txt，每行一条短语）',
      buttonLabel: '导入',
      properties: ['openFile'],
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true }
    try {
      const text = readFileSync(r.filePaths[0], 'utf-8')
      return { ok: true, lines: text.split(/\r?\n/) }
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
  })
  ipcMain.handle('settings:exportOveruseTxt', async (e, lines: string[]) => {
    const opts = {
      title: '导出用词词表（.txt，每行一条短语）',
      defaultPath: '用词词表.txt',
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    } as Electron.SaveDialogOptions
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true }
    try {
      writeFileAtomic(r.filePath, lines.join('\n') + '\n')
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  // 项目
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:create', (_e, name: string, description: string, template?: string) => createProject(name, description, template))
  ipcMain.handle('project:templates', () => listTemplates())
  ipcMain.handle('project:remove', (_e, id: string) => {
    const r = removeProject(id)
    if (r.ok) removeRecent(id)
    return r
  })
  ipcMain.handle('project:import', (_e, dir: string) => importProject(dir))
  ipcMain.handle('project:importPicker', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择要导入的已有目录',
      properties: ['openDirectory']
    })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ipcMain.handle('project:reveal', (_e, id: string) => {
    shell.showItemInFolder(projectDir(id))
  })
  // 导出项目（模块设计 §四 A「打开目录 / 导出 / 删除」）：选目标位置 → 复制项目目录（跳过 .git/.DS_Store/node_modules，与导入同 skip 列表）
  ipcMain.handle('project:export', async (e, id: string) => {
    const opts = {
      title: '选择导出位置（将创建同名项目文件夹）',
      buttonLabel: '导出到这里',
      properties: ['openDirectory', 'createDirectory']
    } as Electron.OpenDialogOptions
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true, error: '已取消' }
    return exportProject(id, r.filePaths[0])
  })
  ipcMain.handle('project:open', (_e, id: string) => {
    recordOpen(id)
    watchProject(id, (evt) => broadcastToAll(evt))
    // 写作习惯学习 D-L-4（2026-09-22 增量 4c）：开关开 + 距上次 ≥7 天 → 后台静默跑一次，不弹窗。
    // 门控/失败都不会抛（runWritingInsights 内部 try/catch + reason 返回）；setImmediate 确保 project:open
    // 响应先返回（gatherSignals 是同步 IO 读快照，大项目会阻塞 IPC 响应——04c 落档观察项）。
    setImmediate(() => void runWritingInsights(id))
    return true
  })
  ipcMain.handle('project:recents', () => getRecentEntries())
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
  // 删除文档：进系统废纸篓（可恢复）；renderer 侧需先弹确认
  ipcMain.handle('doc:delete', (_e, id: string, rel: string) => deleteDoc(id, rel))
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
  // 渲染层保存动作取证（P1 F-20260917-10 残余：渲染层根因无日志；fire-and-forget 旁路留痕，仅取证不改行为）
  ipcMain.handle('doc:saveTrace', (_e, id: string, rel: string, entry: SaveTraceEntry) => {
    appendSaveTrace(id, rel, entry)
    return true
  })

  // 章节管理（§6.2）：重命名（改约定头题名＋文件名，联动大纲副产物/版本历史）、删除（正文+大纲副产物进废纸篓）、导出单章 md
  ipcMain.handle('chapter:rename', (_e, id: string, rel: string, newTitle: string) => renameChapter(id, rel, newTitle))
  ipcMain.handle('chapter:editSlice', (_e, id: string, rel: string, newSlice: string) => editChapterSlice(id, rel, newSlice))
  ipcMain.handle('chapter:delete', (_e, id: string, rel: string) => deleteChapter(id, rel))
  ipcMain.handle('chapter:export', async (e, id: string, rel: string) => {
    const cur = readDoc(id, rel)
    if (cur === null) return { ok: false, error: '章节不存在' }
    // 导出纯正文（去约定头——约定头是织卷内部半结构化元数据，对外分享的正文不含它）
    const { body } = extractFrontMatter(cur)
    const name = (rel.replace(/^正文\//, '').replace(/\.md$/, '') || '章节') + '.md'
    const opts = {
      title: '导出单章（Markdown）',
      defaultPath: join(app.getPath('documents'), name),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    } as Electron.SaveDialogOptions
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { cancelled: true }
    writeFileAtomic(r.filePath, body)
    return { ok: true, path: r.filePath }
  })

  // 素材库域（模块设计 §九：类别树 / 新建类别 / 文件名+全文搜索）
  ipcMain.handle('library:categories', (_e, id: string) => listLibraryCategories(id))
  ipcMain.handle('library:createCategory', (_e, id: string, name: string) => createLibraryCategory(id, name))
  ipcMain.handle('library:recentDocs', (_e, id: string, n?: number) => recentLibraryDocs(id, n))
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
  // 时间线（线枚举，2026-09-16 多时间线叙事）：正文为源现扫章头（与 listSlices 同扫描），建章向导/线徽标共用
  ipcMain.handle('lines:list', (_e, projectId: string) => listLines(projectDir(projectId)))

  // 保存正文前置快检（本地规则，与 presence 同口径）：单章「名单外出场」命中（零模型）
  ipcMain.handle('presence:chapterUnlisted', (_e, id: string, chapterRel: string) => runChapterUnlisted(id, chapterRel))
  // 保存正文前置快检（local 侧）：单章「列入未出场」命中（达正文字数阈值才查，零模型）
  ipcMain.handle('presence:chapterMissing', (_e, id: string, chapterRel: string) => runChapterMissing(id, chapterRel))

  // 提案（S4）
  ipcMain.handle('proposal:list', (_e, id: string) => listProposals(libraryRoot(), id))
  ipcMain.handle('proposal:create', (_e, id: string, source: Proposal['source'], chapter: string, slice: string, items: ProposalItem[], meta?: Proposal['meta'], metas?: Proposal['meta'][]) => createProposals(libraryRoot(), id, source, chapter, slice, items, meta, metas))
  // 切片同步专用（2026-09-20 候选 3）：去重「与已拒绝同款」+ 返回被抑制条数（UI 反馈真实性）
  ipcMain.handle('proposal:createSlice', (_e, id: string, chapter: string, slice: string, items: ProposalItem[]) => createSliceProposals(libraryRoot(), id, chapter, slice, items))
  ipcMain.handle('proposal:apply', (_e, id: string, pid: string) => {
    const res = applyProposal(libraryRoot(), id, pid)
    const p = listProposals(libraryRoot(), id).find((x) => x.id === pid)
    if (res.ok && p?.meta?.annotations?.length) resolveAnnotationRows(id, p.meta.annotations)
    return res
  })
  ipcMain.handle('proposal:reject', (_e, id: string, pid: string) => {
    const p = listProposals(libraryRoot(), id).find((x) => x.id === pid)
    const res = rejectProposal(libraryRoot(), id, pid)
    if (res && p?.meta?.annotations?.length) resolveAnnotationRows(id, p.meta.annotations)
    return res
  })
  ipcMain.handle('proposal:discard', (_e, id: string, pid: string) => discardProposal(libraryRoot(), id, pid))

  // 批注定时优化（主人 2026-09-12）：扫描项目批注 csv → 引擎改写 → 提案制闭环
  ipcMain.handle('annotations:scan', (_e, id: string) => scanAnnotations(id))
  ipcMain.handle('annotations:add', (_e, id: string, mdRel: string, entry: { loc: string; before: string; note: string }) => addAnnotation(id, mdRel, entry))
  ipcMain.handle('annotations:list', (_e, id: string, mdRel: string) => listAnnotations(id, mdRel))
  ipcMain.handle('annotations:remove', (_e, id: string, mdRel: string, row: number) => removeAnnotation(id, mdRel, row))

  // agent（dsh 写作引擎）
  registerAgentIpc()
}
