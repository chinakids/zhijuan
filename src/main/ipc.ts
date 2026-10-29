// ===== 织卷 V2 · IPC 路由（renderer 唯一入口） =====
import { ipcMain, shell, BrowserWindow, dialog, app } from 'electron'
import { readFileSync, existsSync, renameSync, statSync, mkdirSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { join, resolve, dirname, sep, basename } from 'path'
import type { AppSettings, AppDiagnostics, ForensicsEntry, FsEvent, ProposalItem, EditItem, Proposal, SaveTraceEntry } from '../shared/types'
import { adoptActsChapter } from '../shared/actsAdopt'
import { countWords } from '../shared/count'
import { extractFrontMatter } from '../shared/fmatter'
import { listProposals, createProposals, createSliceProposals, applyProposal, rejectProposal, reopenProposal, discardProposal } from './proposals'
import { listLines, listSlices } from './slices'
import { listSnapshots, readSnapshot } from './history'
import { registerAgentIpc } from './agent/ipc'
import { runChapterUnlisted, runChapterMissing } from './agent/audit'
import { scanAnnotations, resolveAnnotationRows, addAnnotation, listAnnotations, removeAnnotation } from './agent/annotations'
import { isRuntimeCreated, closeHarness, ensureHarness, runtimeDir } from './agent/runtime'
import { syncLogPath } from './agent/syncLog'
import { writeLogPath } from './writeLog'
import { saveTracePath } from './saveTrace'
import { log, logError, logDir, logPath, readLogTail, readTailLines } from './log'
import type { LogLevel } from './log'
import { activeProvider } from '../shared/providers'
import { getSettings, setSettings, libraryRoot } from './settings'
import { getRecentEntries, recordOpen, removeRecent } from './recent'
import {
  listProjects,
  createProject,
  updateProject,
  removeProject,
  importProject,
  exportProject,
  projectDir,
  readDoc,
  writeDoc,
  deleteDoc,
  renameDoc,
  uniqueDocName,
  listDocs,
  listChapters,
  renameChapter,
  editChapterSlice,
  editChapterLine,
  editChapterCast,
  suggestChapterCast,
  reorderChapter,
  deleteChapter,
  watchProject
} from './store'
import { workspaceStatus, ensureWorkspaceDocs, readWorkspaceDoc } from './workspace'
import { runCollectTask, scanPendingTasks, startCollectorAuto } from './agent/collector'
import { appendSaveTrace } from './saveTrace'
import { runWritingInsights } from './writingInsights'
import { buildCompiledBody, buildChapterInputs } from './compile'
import { chapterBodyOf } from '../shared/compile'
import { exportDocx, docxAvailable } from './compileDocx'
import { exportEpub } from './compileEpub'
import { listLibraryCategories, createLibraryCategory, searchDocs, recentLibraryDocs } from './library'
import { listTemplates } from './templates'
import { workspaceDir } from './settings'
import { sanitizeFile } from '../shared/paths'

export function broadcastToAll(evt: FsEvent) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('fs:event', evt)
  }
}

/** 取证文件清单（2026-10-27 可见性 E）：主进程日志 + 项目 `.zhijuan` 三件套。
 * 此前 write-log/save-trace/sync-log 只写不读，排障只能自己猜路径——这里统一给出路径/大小/尾部。 */
function collectForensics(projectId: string | null): ForensicsEntry[] {
  const out: ForensicsEntry[] = []
  const push = (kind: string, label: string, p: string, maxLines: number) => {
    let bytes = 0
    let mtime = 0
    let exists = false
    try {
      const st = statSync(p)
      exists = st.isFile()
      bytes = st.size
      mtime = st.mtimeMs
    } catch {
      exists = false
    }
    out.push({ kind, label, path: p, exists, bytes, mtime, tail: exists ? readTailLines(p, maxLines) : [] })
  }
  push('main-log', '主进程日志（main.log）', logPath(), 20)
  if (projectId) {
    push('write-log', '正文写盘审计（write-log.jsonl）', writeLogPath(projectId), 20)
    push('save-trace', '渲染层保存取证（save-trace.jsonl）', saveTracePath(projectId), 20)
    push('sync-log', '切片同步历史（sync-log.jsonl）', syncLogPath(projectId), 20)
  }
  return out
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
  // 项目信息更新（名称/简介）：只改 project.md 约定头，目录名/id 不变
  ipcMain.handle('project:update', (_e, id: string, patch: { name?: string; description?: string }) => updateProject(id, patch))
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
    // 采集子 agent 自动派发（collectionEnabled 时每 30s 扫 pending 卡；开关每次 tick 现读）
    startCollectorAuto(id)
    return true
  })
  ipcMain.handle('project:recents', () => getRecentEntries())
  ipcMain.handle('app:getPaths', () => ({
    documents: libraryRoot(),
    defaultLibrary: shell ? String(process.env.HOME) : ''
  }))
  // 版本单一来源：关于页与系统「关于」面板同读 app.getVersion()（package.json version + 打包注入），
  // 渲染层不再硬编码，避免双源漂移。
  ipcMain.handle('app:version', () => app.getVersion())

  // ===== 诊断与取证（2026-10-27 可见性 P1）=====
  // 一次性带走排障现场：版本/平台/引擎状态/关键路径/主进程日志尾——设置页「导出诊断」直接序列化落盘。
  // 引擎未建过 runtime 时**不**触发启动（ensureHarness 会拉子进程，第一启最长 45s），只报「未启动」+原因。
  ipcMain.handle('app:diagnostics', async (): Promise<AppDiagnostics> => {
    const cfg = activeProvider(getSettings())
    const engine: AppDiagnostics['engine'] = {
      online: false,
      provider: cfg.preset.name,
      model: cfg.model,
      message: '引擎未启动（本会话还没有发起写作请求；「写作引擎」页可重启）'
    }
    if (isRuntimeCreated()) {
      try {
        const err = await ensureHarness()
        engine.online = !err
        engine.message = err ?? ''
      } catch (e) {
        engine.message = String((e as Error)?.message ?? e)
      }
    }
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      engine,
      paths: {
        libraryRoot: libraryRoot(),
        userData: app.getPath('userData'),
        runtimeDir: runtimeDir()
      },
      logTail: readLogTail(200)
    }
  })
  // 导出诊断快照 JSON（系统保存对话框；与 chapter:export 同范式）
  ipcMain.handle('app:diagnosticsExport', async (e, payload: unknown) => {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}, null, 2)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const opts = {
      title: '导出诊断快照（JSON）',
      defaultPath: join(app.getPath('documents'), `织卷诊断-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    } as Electron.SaveDialogOptions
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true }
    try {
      writeFileAtomic(r.filePath, text)
      log('info', `诊断快照已导出 → ${r.filePath}`, 'diagnostics')
      return { ok: true, path: r.filePath }
    } catch (err) {
      logError('diagnosticsExport', err)
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })
  // 打开日志目录（诊断日志的家；shell.openPath 返回空串=成功）
  ipcMain.handle('app:openLogDir', async () => {
    try {
      mkdirSync(logDir(), { recursive: true })
      const err = await shell.openPath(logDir())
      return err ? { ok: false, error: err, path: logDir() } : { ok: true, path: logDir() }
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e), path: logDir() }
    }
  })
  // 取证清单（E：write-log / save-trace / sync-log / main.log 有写无读的入口）
  ipcMain.handle('app:forensics', (_e, projectId?: string | null) => collectForensics(projectId ?? null))
  // 在文件管理器里定位（限日志目录 / 项目库内，避免渲染层任意路径穿越）
  ipcMain.handle('app:revealPath', (_e, p: string) => {
    try {
      if (!p) return { ok: false, error: '路径为空' }
      const abs = resolve(p)
      const roots = [logDir(), libraryRoot()].map((r) => resolve(r))
      if (!roots.some((r) => abs === r || abs.startsWith(r + sep))) {
        return { ok: false, error: '只允许定位日志目录或项目库内的文件' }
      }
      if (existsSync(abs)) shell.showItemInFolder(abs)
      else void shell.openPath(dirname(abs))
      return { ok: true, path: abs }
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
  })
  // 渲染层异常上报（ErrorBoundary）：fire-and-forget 落主进程日志，白屏现场不再只在 DevTools
  ipcMain.on('app:log', (_e, level: string, message: string) => {
    const lv: LogLevel = level === 'debug' || level === 'info' || level === 'warn' ? level : 'error'
    log(lv, String(message ?? ''), 'renderer')
  })

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
  // 文档重命名（人物/世界观/素材卡通用）：改名 + H1/版本历史目录随动；章节重命名另走 chapter:rename
  ipcMain.handle('doc:rename', (_e, id: string, rel: string, newName: string) => renameDoc(id, rel, newName))
  // 新建档案查重：返回目录内未被占用的名字（同名 → 「名字 2」…），写盘前调用防覆盖
  ipcMain.handle('doc:uniqueName', (_e, id: string, relDir: string, name: string) => uniqueDocName(id, relDir, name))
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
  ipcMain.handle('chapter:editLine', (_e, id: string, rel: string, newLine: string) => editChapterLine(id, rel, newLine))
  // 章节「涉及人物」：建章后唯一修正入口（2026-10-28，F-20261028-07）；suggest=按正文识别漏列人物（本地规则）
  ipcMain.handle('chapter:editCast', (_e, id: string, rel: string, cast: string[]) => editChapterCast(id, rel, cast))
  ipcMain.handle('chapter:suggestCast', (_e, id: string, rel: string) => suggestChapterCast(id, rel))
  ipcMain.handle('chapter:reorder', (_e, id: string, rel: string, dir: number) => reorderChapter(id, rel, dir))
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

  // 作品编译：整书合并导出单文件 Markdown 成品（Scrivener Compile 同构；模块设计 §四 A 扩展）。
  // 只读拼接（buildCompiledBody）；对话框 + 落盘在这里（与 chapter:export 同模式）。
  ipcMain.handle('project:compileExport', async (e, id: string) => {
    const built = buildCompiledBody(id)
    if (!built.ok) return { ok: false, error: built.error }
    if (!built.body) return { ok: false, error: '没有可导出的正文' }
    const opts = {
      title: '导出作品（合并 Markdown）',
      defaultPath: join(app.getPath('documents'), `${basename(projectDir(id))}_成品.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    } as Electron.SaveDialogOptions
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { cancelled: true }
    writeFileAtomic(r.filePath, built.body)
    return { ok: true, path: r.filePath, chapters: built.chapters }
  })

  // 作品编译 v1.1：Word 导出（零依赖＝系统 textutil html→docx；win/linux 优雅回退 Markdown）。
  // 与 compileExport 同模式：buildCompiledBody 只读拼接 → mdToHtml → textutil（src/main/compileDocx.ts）。
  ipcMain.handle('project:compileExportDocx', async (e, id: string) => {
    const built = buildCompiledBody(id)
    if (!built.ok) return { ok: false, error: built.error }
    if (!built.body) return { ok: false, error: '没有可导出的正文' }
    if (!docxAvailable()) return { ok: false, error: 'Word 导出需要 macOS 自带的 textutil（当前系统未找到），请改用合并 Markdown 导出' }
    const opts = {
      title: '导出作品（Word）',
      defaultPath: join(app.getPath('documents'), `${basename(projectDir(id))}_成品.docx`),
      filters: [{ name: 'Word 文档', extensions: ['docx'] }]
    } as Electron.SaveDialogOptions
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { cancelled: true }
    const res = exportDocx(built.body, r.filePath)
    if (!res.ok) return { ok: false, error: res.error }
    return { ok: true, path: r.filePath, chapters: built.chapters }
  })

  // 作品编译 v1.2：EPUB 导出（零依赖＝系统 zip 打包 EPUB3 容器；2026-09-24 04:30 轮实证容器可行）。
  // 与 compileExport 同模式：buildChapterInputs 只读收集 → buildEpubFiles → zip（src/main/compileEpub.ts）；
  // 分章输入（EPUB 按章分 XHTML 内容文档 + nav 目录，非合并单文件）。
  ipcMain.handle('project:compileExportEpub', async (e, id: string) => {
    let inputs: ReturnType<typeof buildChapterInputs>
    try {
      inputs = buildChapterInputs(id)
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
    // 章数 = 实际产出（空章跳过，与 compileNovel/buildEpubFiles 同口径）
    const total = inputs.filter((c) => chapterBodyOf(c.text)).length
    const projName = basename(projectDir(id))
    const opts = {
      title: '导出作品（EPUB）',
      defaultPath: join(app.getPath('documents'), `${projName}_成品.epub`),
      filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }]
    } as Electron.SaveDialogOptions
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { cancelled: true }
    const res = exportEpub(inputs, projName, r.filePath)
    if (!res.ok) return { ok: false, error: res.error }
    return { ok: true, path: r.filePath, chapters: total }
  })

  // 素材库域（模块设计 §九：类别树 / 新建类别 / 文件名+全文搜索）
  ipcMain.handle('library:categories', (_e, id: string) => listLibraryCategories(id))
  ipcMain.handle('library:createCategory', (_e, id: string, name: string) => createLibraryCategory(id, name))
  // 类别改名（可选 P2）：类别＝素材库/ 下的一级目录，改名=目录改名（素材卡与版本历史目录随路径走）；
  // 口径与 createLibraryCategory 一致（trim + sanitizeFile + 「采集池」工具目录保护）。
  ipcMain.handle('library:renameCategory', (_e, id: string, from: string, to: string) => {
    const src = join(projectDir(id), '素材库', from ?? '')
    if (!from) return { ok: false, error: '类别名为空' }
    if (from === '采集池') return { ok: false, error: '「采集池」是工具目录，不能改名' }
    const safe = sanitizeFile((to ?? '').trim())
    if (!safe) return { ok: false, error: '名称不能为空' }
    if (!existsSync(src)) return { ok: false, error: `类别「${from}」不存在` }
    if (safe === from) return { ok: true, name: safe }
    const dst = join(projectDir(id), '素材库', safe)
    if (existsSync(dst)) return { ok: false, error: `类别「${safe}」已存在` }
    try {
      renameSync(src, dst)
      return { ok: true, name: safe }
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
  })
  // 类别删除（可选 P2）：整个类别目录移入系统废纸篓（可恢复，与素材卡/项目删除同先例）
  ipcMain.handle('library:deleteCategory', async (_e, id: string, name: string) => {
    if (!name) return { ok: false, error: '类别名为空' }
    if (name === '采集池') return { ok: false, error: '「采集池」是工具目录，不能删除' }
    const dir = join(projectDir(id), '素材库', name)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return { ok: false, error: `类别「${name}」不存在` }
    if (!shell) return { ok: false, error: '当前环境不支持系统废纸篓' }
    try {
      await shell.trashItem(dir)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
  })
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
  ipcMain.handle('proposal:create', (_e, id: string, source: Proposal['source'], chapter: string, slice: string, items: ProposalItem[], meta?: Proposal['meta'], metas?: Proposal['meta'][], protectIds?: Set<string>) => createProposals(libraryRoot(), id, source, chapter, slice, items, meta, metas, protectIds))
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
  ipcMain.handle('proposal:reopen', (_e, id: string, pid: string) => reopenProposal(libraryRoot(), id, pid))

  // 批注定时优化（主人 2026-09-12）：扫描项目批注 csv → 引擎改写 → 提案制闭环
  ipcMain.handle('annotations:scan', (_e, id: string) => scanAnnotations(id))
  ipcMain.handle('annotations:add', (_e, id: string, mdRel: string, entry: { loc: string; before: string; note: string }) => addAnnotation(id, mdRel, entry))
  ipcMain.handle('annotations:list', (_e, id: string, mdRel: string) => listAnnotations(id, mdRel))
  ipcMain.handle('annotations:remove', (_e, id: string, mdRel: string, row: number) => removeAnnotation(id, mdRel, row))

  // ===== 采集子 agent（待处理任务卡 → 独立 pi 会话；卡 running→done/failed） =====
  // 手动派发一张：taskRel 相对项目根（素材库/采集池/任务_<ts>.md）。返回 {ok,status,message,resultRel}，
  // 单个任务最长 180s（主进程内超时即置 failed），渲染层按钮态自己兜。
  ipcMain.handle('collect:run', (_e, id: string, taskRel: string) => runCollectTask(id, taskRel))
  // 待派发清单（UI 轮询/诊断用；自动派发也走同一扫描）
  ipcMain.handle('collect:pending', (_e, id: string) => scanPendingTasks(id))

  // agent（dsh 写作引擎）
  registerAgentIpc()
}
