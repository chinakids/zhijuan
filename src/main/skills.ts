// ===== 织卷 · 技能包读写（主进程；纯解析/校验/生成在 shared/skills.ts） =====
// 存放：<工作区>/skills/<技能名>/SKILL.md（作者资产跨项目；D-V2-8 工作区=设置页「工作区」）。
// 一期只支持 SKILL.md（纯指令）+ 目录内 references/ 子文件（技能正文引用，模型 zj_read_doc 现读）。
// 扫描策略：每次调用现读（技能集个位数、文件小；设置管理增量做增删改后的失效重扫再考虑缓存）。
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { workspaceDir } from './settings'
import {
  parseSkillFile,
  validateSkillDir,
  validateSkillDraft,
  renderSkillFile,
  skillNameValid,
  type SkillMeta,
  type SkillDraft,
  type SkillWriteResult
} from '../shared/skills'
import { setFrontMatterField, removeFrontMatterField } from '../shared/fmatter'

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

// ===== 写面（2026-09-21 设置管理增量 · 智能层数据链） =====
// 口径：写面只回 {ok}|{ok:false,error}；操作后状态一律重新 listSkills 拉取（与 devShim mock 同口径）。
// 校验=shared/skills.ts validateSkillDraft（单一闸）；写盘=renderSkillFile 生成 / 导入原样保真。

function skillDirOf(name: string): string {
  return join(workspaceDir(), 'skills', name)
}

/** 创建技能：draft 校验通过 + 目录不存在 → mkdir + 写 SKILL.md（renderSkillFile 生成） */
export function createSkill(draft: SkillDraft): SkillWriteResult {
  const err = validateSkillDraft(draft)
  if (err) return { ok: false, error: err }
  const name = draft.name.trim()
  const dir = skillDirOf(name)
  if (existsSync(dir)) return { ok: false, error: `技能「${name}」已存在` }
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), renderSkillFile(draft), 'utf-8')
  } catch (e) {
    return { ok: false, error: `技能写入失败：${(e as Error).message}` }
  }
  return { ok: true }
}

/** 更新技能：目录存在 + draft 校验通过；name 必须与现目录名一致（改名=删除+新建，避免 references 迁移面） */
export function updateSkill(name: string, draft: SkillDraft): SkillWriteResult {
  const err = validateSkillDraft(draft)
  if (err) return { ok: false, error: err }
  if (draft.name.trim() !== name) return { ok: false, error: '技能不改名（改名请用删除+新建）' }
  const dir = skillDirOf(name)
  if (!existsSync(dir)) return { ok: false, error: `技能「${name}」不存在` }
  try {
    writeFileSync(join(dir, 'SKILL.md'), renderSkillFile(draft), 'utf-8')
  } catch (e) {
    return { ok: false, error: `技能写入失败：${(e as Error).message}` }
  }
  return { ok: true }
}

/** 删除技能：目录不存在 → error；否则 rm -rf（含 references/ 子文件） */
export function deleteSkill(name: string): SkillWriteResult {
  const dir = skillDirOf(name)
  if (!existsSync(dir)) return { ok: false, error: `技能「${name}」不存在` }
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    return { ok: false, error: `技能删除失败：${(e as Error).message}` }
  }
  return { ok: true }
}

/** 开关禁用：文本级改 disabled 字段（保其他行原样=保真；禁用=设 true，解禁=删行） */
export function setSkillDisabled(name: string, disabled: boolean): SkillWriteResult {
  const file = join(skillDirOf(name), 'SKILL.md')
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return { ok: false, error: `技能「${name}」不存在` }
  }
  const next = disabled ? setFrontMatterField(raw, 'disabled', 'true') : removeFrontMatterField(raw, 'disabled')
  try {
    writeFileSync(file, next, 'utf-8')
  } catch (e) {
    return { ok: false, error: `技能写入失败：${(e as Error).message}` }
  }
  return { ok: true }
}

/** 导入 .md（织卷格式/标准子集均可）：按 front matter name 建目录、原文写盘（保真）；剥 BOM */
export function importSkill(mdText: string): SkillWriteResult {
  const text = (mdText ?? '').replace(/^\uFEFF/, '')
  const meta = parseSkillFile(text)
  if (!meta) return { ok: false, error: '导入失败：不是合法的 SKILL.md（需 --- 约定头且 name/description 必填）' }
  if (!skillNameValid(meta.name)) return { ok: false, error: `导入失败：name「${meta.name}」不合法` }
  const dir = skillDirOf(meta.name)
  if (existsSync(dir)) return { ok: false, error: `导入失败：技能「${meta.name}」已存在` }
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), text, 'utf-8')
  } catch (e) {
    return { ok: false, error: `技能导入失败：${(e as Error).message}` }
  }
  return { ok: true }
}

/** 导出原文（含 front matter 全文；织卷扩展字段原样保留，标准客户端忽略即可） */
export function exportSkill(name: string): { ok: true; text: string } | { ok: false; error: string } {
  const file = join(skillDirOf(name), 'SKILL.md')
  try {
    return { ok: true, text: readFileSync(file, 'utf-8') }
  } catch {
    return { ok: false, error: `技能「${name}」不存在` }
  }
}
