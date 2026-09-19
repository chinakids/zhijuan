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

/** 项目骨架缺省模板（与 ensureSkeleton 同源；devShim 新建项目/演示种子同口径——单一权威源，改这里同步改 store/devShim 消费方） */
export const SKELETON_TEMPLATES = {
  charsOverview:
    '# 人物 · 总览\n\n> 本文件是人物目录：每个人物一个 `人物/<人物名>.md`。在正文创作里保存章节后，这里会通过提案制得到更新。\n',
  worldOverview:
    '# 世界观 · 总纲\n\n> 长期不变的世界设定写在这里；每个时间切片的世界状态写在 `世界观/切片_<切片名>.md`。\n',
  libIndex:
    '# 素材库 · 索引\n\n> 按类别分类存放，每个素材一个 `素材库/<类别>/<素材>.md`。采集任务先落 `素材库/采集池/`。\n'
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

/** 世界切片文件：世界观/切片_<切片名>.md（模块设计 §8；正文保存时切片同步写入，每切片一个） */
export function worldSliceFile(slice: string): string {
  return `${DIR.worldview}/切片_${slice}.md`
}
