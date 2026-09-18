// ===== 织卷 V2 · 应用设置（模块设计 §十二 模块 I；自持状态，从 fileStore 拆出） =====
// 拆分理由见 docs/架构评审与调整-2026-09-04.md §二-1：settings 不进 store，加厂商字段不碰文件库。
import { app } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { DEFAULT_SETTINGS } from '../shared/types'
import type { AppSettings } from '../shared/types'
import { resolveLibraryRoot } from '../shared/settingsLogic'

function settingsFile(): string {
  return join(app.getPath('userData'), 'zhijuan-settings.json')
}
function ensureDir(p: string) {
  mkdirSync(p, { recursive: true })
}

/** 老版本设置的平滑迁移：扁平 llm { baseUrl, model, apiKey } → llm.providers.local；去掉已废弃的 agentEngine */
export function normalizeSettings(s: AppSettings): AppSettings {
  const out: any = { ...s }
  const llm = out.llm ?? {}
  if (typeof llm.baseUrl === 'string' || typeof llm.model === 'string') {
    out.llm = {
      active: 'local',
      providers: {
        local: {
          ...(typeof llm.baseUrl === 'string' && llm.baseUrl ? { baseUrl: llm.baseUrl } : {}),
          ...(typeof llm.model === 'string' && llm.model ? { model: llm.model } : {}),
          ...(typeof llm.apiKey === 'string' && llm.apiKey ? { apiKey: llm.apiKey } : {})
        }
      }
    }
  } else {
    out.llm = {
      active:
        llm.active === 'local' || llm.active === 'deepseek' || llm.active === 'glm' || llm.active === 'openai' || llm.active === 'claude' || llm.active === 'gemini'
          ? llm.active
          : 'local',
      providers: llm.providers ?? {}
    }
  }
  delete out.agentEngine
  return out as AppSettings
}
/** 读盘并合并默认（导出供单测验证旧文件迁移；2026-09-18 体验层 foldedCols 键新增） */
export function readSettings(): AppSettings {
  try {
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsFile(), 'utf-8')) })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
function writeSettings(s: AppSettings) {
  ensureDir(dirname(settingsFile()))
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf-8')
}
let settingsCache: AppSettings = readSettings()
export function getSettings(): AppSettings {
  return settingsCache
}
export function setSettings(patch: Partial<AppSettings>): AppSettings {
  settingsCache = { ...settingsCache, ...patch }
  writeSettings(settingsCache)
  return settingsCache
}

// ---------- 路径（跟随设置） ----------
/** 工作区根目录：设置为空时用 文档/织卷工作区 */
export function workspaceDir(): string {
  const w = getSettings().workspace
  return w && w.trim() ? w.trim() : join(app.getPath('documents'), '织卷工作区')
}
/** 库根：设置非空优先；否则老默认位（文档/织卷项目库）非空时保持原地（D-V2-8），再落 工作区/项目库。
 * 决策链在 shared/settingsLogic（真机与 devShim 共用，2026-09-12）；本函数只负责感知 fs 实况。 */
export function libraryRoot(): string {
  const legacy = join(app.getPath('documents'), '织卷项目库')
  let legacyExists = false
  try {
    legacyExists = existsSync(legacy) && readdirSync(legacy).length > 0
  } catch {
    /* 读不了就按空处理 */
  }
  return resolveLibraryRoot({
    configured: getSettings().libraryRoot,
    legacyPath: legacy,
    workspaceDefault: workspaceDir(),
    legacyExists
  })
}
