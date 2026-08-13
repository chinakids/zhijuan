import { app, ipcMain } from 'electron'
import { join } from 'path'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import type { Project, Chapter } from '../shared/types'
import { normalizeProject, currentChapter } from '../shared/setting'

/** 项目根目录（默认：文档/织卷 项目库；可通过设置改） */
function libraryRoot(): string {
  return join(app.getPath('documents'), '织卷项目库')
}

function projectDir(id: string): string {
  return join(libraryRoot(), id)
}

function projectFile(id: string): string {
  return join(projectDir(id), 'project.json')
}

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true })
}

function writeJson(path: string, data: unknown) {
  ensureDir(join(path, '..'))
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** ---------- 项目 ---------- */
function createProject(name: string, description: string): Project {
  const p: Project = {
    id: newId(),
    name,
    description,
    worldview: { name: '', city: '', era: '', themes: [], rules: [], background: '' },
    characters: [],
    chapters: [],
    elements: [],
    records: [],
    foreshadows: [],
    sweepDrafts: [],
    updatedAt: Date.now()
  }
  writeJson(projectFile(p.id), p)
  return p
}

function listProjects(): { id: string; name: string; description: string; updatedAt: number }[] {
  ensureDir(libraryRoot())
  return readdirSync(libraryRoot(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readJson<Project>(projectFile(d.name)))
    .filter((p): p is Project => p !== null)
    .map((p) => ({ id: p.id, name: p.name, description: p.description, updatedAt: p.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function loadProject(id: string): Project | null {
  const p = readJson<Project>(projectFile(id))
  if (!p) return null
  const before = JSON.stringify(p)
  normalizeProject(p)
  // 旧数据补齐字段后写回一次，保证后续一致
  if (before !== JSON.stringify(p)) writeJson(projectFile(id), p)
  return p
}

function saveProject(p: Project): Project {
  normalizeProject(p)
  p.updatedAt = Date.now()
  writeJson(projectFile(p.id), p)
  return p
}

function deleteProject(id: string): void {
  const dir = projectDir(id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/** ---------- 段落导出（把一章正文落到项目目录，方便接其它工具） ---------- */
function exportChapter(project: Project, chapter: Chapter) {
  const dir = projectDir(project.id)
  ensureDir(dir)
  const name = `第${chapter.num}章_${sanitize(chapter.title || '未命名')}.md`
  const body = [
    `# ${chapter.title}`,
    '',
    `> 本篇要素：${chapter.elements}`,
    '',
    chapter.content
  ].join('\n')
  writeFileSync(join(dir, name), body, 'utf-8')
  return join(dir, name)
}

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)
}

/** ---------- IPC 注册 ---------- */
export function registerStoreIpc() {
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:create', (_e, name: string, description: string) => createProject(name, description))
  ipcMain.handle('project:load', (_e, id: string) => loadProject(id))
  ipcMain.handle('project:save', (_e, p: Project) => saveProject(p))
  ipcMain.handle('project:delete', (_e, id: string) => deleteProject(id))
  // 章节正文导出（供与外部工作流衔接）
  ipcMain.handle('chapter:export', (_e, project: Project, chapter: Chapter) => exportChapter(project, chapter))
}

export { newId, currentChapter }
