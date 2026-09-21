// ===== 织卷 · 技能包读取（主进程；纯解析在 shared/skills.ts） =====
// 存放：<工作区>/skills/<技能名>/SKILL.md（作者资产跨项目；D-V2-8 工作区=设置页「工作区」）。
// 一期只支持 SKILL.md（纯指令）+ 目录内 references/ 子文件（技能正文引用，模型 zj_read_doc 现读）。
// 扫描策略：每次调用现读（技能集个位数、文件小；设置管理增量做增删改后的失效重扫再考虑缓存）。
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { workspaceDir } from './settings'
import { parseSkillFile, validateSkillDir, type SkillMeta } from '../shared/skills'

function readOneSkill(skillDir: string): SkillMeta | null {
  const file = join(skillDir, 'SKILL.md')
  if (!existsSync(file)) return null
  let raw = ''
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return null // 读不了=跳过（不阻断创作）
  }
  const meta = parseSkillFile(raw)
  if (!meta) return null // 缺必填字段/非约定头=不生效
  const dirName = skillDir.split(/[\\/]/).pop() ?? ''
  validateSkillDir(meta, dirName) // 不一致 → meta.invalid 置位（清单/匹配按不生效处理，但保留详情供冒烟断言）
  return meta
}

/** 扫描工作区技能目录 → SkillMeta[]（含 body；invalid 项带原因，调用方按 !disabled && !invalid 过滤） */
export function listSkills(): SkillMeta[] {
  const root = join(workspaceDir(), 'skills')
  let names: string[] = []
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return [] // 目录不存在=无技能
  }
  const out: SkillMeta[] = []
  for (const n of names) {
    const meta = readOneSkill(join(root, n))
    if (meta) out.push(meta)
  }
  return out
}
