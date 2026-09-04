// ===== 织卷 V2 · 应用设置（模块设计 §十二 模块 I；自持状态，从 fileStore 拆出） =====
// 拆分理由见 docs/架构评审与调整-2026-09-04.md §二-1：settings 不进 store，加厂商字段不碰文件库。
import { app } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { DEFAULT_SETTINGS } from '../shared/types'
import type { AppSettings } from '../shared/types'

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
function readSettings(): AppSettings {
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
/** 库根：设置非空优先；否则老默认位（文档/织卷项目库）非空时保持原地（D-V2-8），再落 工作区/项目库 */
export function libraryRoot(): string {
  const r = getSettings().libraryRoot
  if (r && r.trim()) return r.trim()
  const legacy = join(app.getPath('documents'), '织卷项目库')
  if (existsSync(legacy)) {
    try {
      if (readdirSync(legacy).length > 0) return legacy
    } catch {
      /* 读不了就按空处理 */
    }
  }
  return join(workspaceDir(), '项目库')
}
