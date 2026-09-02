// ===== 织卷 V2 · 项目目录路径约定（模块设计 §2.2） =====

export const PROJ_FILE = 'project.md'
export const DOT_DIR = '.zhijuan'

export const DIR = {
  novel: '正文',
  characters: '人物',
  worldview: '世界观',
  library: '素材库',
  collection: '素材库/采集池'
} as const

export const DEFAULT_FILES = {
  charsOverview: '人物/总览.md',
  worldOverview: '世界观/总纲.md',
  libIndex: '素材库/索引.md'
} as const

/** 一个项目的基础骨架目录（新建项目时创建） */
export const SKELETON_DIRS: string[] = [
  DIR.novel,
  DIR.characters,
  DIR.worldview,
  DIR.library,
  DIR.collection,
  `${DOT_DIR}/proposals`,
  `${DOT_DIR}/sessions`,
  `${DOT_DIR}/tasks`
]

/** 文件名清洗（去路径分隔符和危险字符） */
export function sanitizeFile(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名'
}
