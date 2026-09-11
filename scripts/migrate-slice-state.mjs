// ===== 织卷 · 旧格式切片小节迁移工具（一次性运维，2026-09-11 创作层）=====
// 背景：V2 早期版本把切片状态写成两类旧格式，与模块设计 §7/§8 约定（H2「## 切片：<切片名>」、
//       世界状态在 世界观/切片_<切片名>.md）不一致，且新 commit 后 applyAnchor 已统一 H2：
//   A) 人物档「## 切片状态」+ 子节「### <切片名>」（agent冒烟 数据）
//   B) 人物/世界「### 切片状态」（无名 H3，织卷smoke 数据；正文切片名唯一时可安全归属）
//   C) 世界状态旧无前缀文件名「世界观/<切片名>.md」→ 新名 切片_<切片名>.md
// 用法：node scripts/migrate-slice-state.mjs [--apply] [项目目录...]
//   默认 dry-run（只打印计划不写盘）；--apply 先备份到 <项目>/.zhijuan/migrate-backup-<ts>/ 再写。
//   无项目目录参数时自动扫描 ~/Documents/织卷项目库 与 ~/Documents/织卷工作区/项目库 下的项目目录。
// 幂等：重复执行无变化（已迁移格式不再命中；旧无前缀名文件保留不删）。
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const APPLY = process.argv.includes('--apply')
const args = process.argv.filter((a) => !a.startsWith('-'))
const ts = new Date().toISOString().replace(/[:.]/g, '-')

// ---------- 块解析 ----------
/** 把 md 文本解析为块序列：{level, header(无#), body[]}；header=null 表示 front matter/开头文本 */
function toBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let idx = 0
  const head = []
  while (idx < lines.length && !/^(#{1,6})\s+/.test(lines[idx])) { head.push(lines[idx]); idx++ }
  if (head.some((l) => l.trim())) blocks.push({ level: 1, header: null, body: head })
  while (idx < lines.length) {
    const m = lines[idx].match(/^(#{1,6})\s+(.*)$/)
    if (!m) { idx++; continue }
    const b = { level: m[1].length, header: m[2].trim(), body: [] }
    idx++
    while (idx < lines.length && !/^(#{1,6})\s+/.test(lines[idx])) { b.body.push(lines[idx]); idx++ }
    blocks.push(b)
  }
  return blocks
}
function serialize(blocks) {
  const parts = []
  for (const b of blocks) {
    if (b.header === null) parts.push(b.body.join('\n'))
    else {
      parts.push('#'.repeat(b.level) + ' ' + b.header)
      if (b.body.length) parts.push(b.body.join('\n'))
    }
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
function isShellSliceFile(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('>')).length === 0
}
/** 从正文约定头收集切片名（去重） */
function collectSliceNames(projectDir) {
  const dir = join(projectDir, '正文')
  if (!existsSync(dir)) return []
  const names = new Set()
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const raw = readFileSync(join(dir, f), 'utf-8')
    const m = raw.match(/^---\n[\s\S]*?^切片:\s*(.+)$/m)
    if (m) names.add(m[1].trim())
  }
  return [...names]
}

// ---------- 迁移变换 ----------
// 注意：toBlocks 是扁平块序列（任何标题行都成块），A 型「## 切片状态 + ### 子节」在序列中表现为
// 「切片状态」块后连续跟若干 level>=3 的子节块——按序列处理而不是按 body 内切分。
/** 人物档：A 型（## 切片状态 + ### 子节块）→ 提升 H2 切片节；B 型（### 切片状态 独立块）→ 唯一切片名归属 */
function migrateCharacter(text, sliceNames) {
  const blocks = toBlocks(text)
  const out = []
  const reports = []
  let changed = false
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.level === 2 && b.header === '切片状态') {
      // A 型：其后连续 >=3 级子节块
      const subs = []
      let j = i + 1
      while (j < blocks.length && blocks[j].level >= 3) { subs.push(blocks[j]); j++ }
      const orphan = b.body.filter((l) => l.trim())
      for (const s of subs) {
        const hd = `切片：${s.header}`
        const k = out.findIndex((x) => x.level === 2 && x.header === hd)
        if (k >= 0) { out[k].body.push(...s.body); reports.push(`子节「${s.header}」并入已有「${hd}」`) }
        else { out.push({ level: 2, header: hd, body: s.body }); reports.push(`子节「${s.header}」提升为 H2「${hd}」`) }
      }
      if (orphan.length) out.push({ level: 2, header: '切片状态', body: orphan })
      changed = true
      i = j - 1
    } else if (b.level === 3 && b.header === '切片状态') {
      // B 型：独立无名 H3 切片状态（内容可在块体）
      if (sliceNames.length === 1 && sliceNames[0]) {
        out.push({ level: 2, header: `切片：${sliceNames[0]}`, body: b.body })
        reports.push(`无名切片状态归到「切片：${sliceNames[0]}」`)
        changed = true
      } else {
        reports.push(`无法归属切片名（候选 ${sliceNames.length}），保留`)
        out.push(b)
      }
    } else out.push(b)
  }
  return { text: changed ? serialize(out) : text, changed, reports }
}
/** 世界总纲：B 型切片状态块 → 生成/填充 世界观/切片_<名>.md，总纲删节 */
function migrateWorldMean(text, sliceNames) {
  const blocks = toBlocks(text)
  const reports = []
  const out = []
  let changed = false
  let sliceBody = []
  for (const b of blocks) {
    if (b.header === '切片状态' && (b.level === 2 || b.level === 3)) {
      if (sliceNames.length === 1 && sliceNames[0]) {
        reports.push(`总纲「切片状态」→ 切片_${sliceNames[0]}.md`)
        sliceBody = b.body.filter((l) => l.trim())
        changed = true
      } else {
        reports.push(`总纲切片状态无法归属（候选 ${sliceNames.length}），保留`)
        out.push(b)
      }
    } else out.push(b)
  }
  return { text: changed ? serialize(out) : text, changed, reports, sliceBody, sliceName: sliceNames.length === 1 ? sliceNames[0] : null }
}

// ---------- 项目处理 ----------
function processProject(projectDir, log) {
  const name = basename(projectDir)
  const sliceNames = collectSliceNames(projectDir)
  log(`\n【${name}】正文切片名候选：${sliceNames.length ? sliceNames.join(' / ') : '（无）'}`)
  const plan = [] // {src, rel, action}
  const toWrite = [] // 实际需要写入的文件（人物/总纲）
  // 1. 人物档
  const charDir = join(projectDir, '人物')
  if (existsSync(charDir)) {
    for (const f of readdirSync(charDir)) {
      if (!f.endsWith('.md')) continue
      const abs = join(charDir, f)
      const r = migrateCharacter(readFileSync(abs, 'utf-8'), sliceNames)
      if (r.changed) {
        for (const rep of r.reports) log(`  人物/${f}：${rep}`)
        plan.push({ rel: `人物/${f}`, action: '改写切片小节' })
        toWrite.push({ rel: `人物/${f}`, text: r.text })
      }
    }
  }
  // 2. 世界：总纲 + 旧无前缀名文件
  const worldDir = join(projectDir, '世界观')
  if (existsSync(worldDir)) {
    const meanAbs = join(worldDir, '总纲.md')
    if (existsSync(meanAbs)) {
      const r = migrateWorldMean(readFileSync(meanAbs, 'utf-8'), sliceNames)
      if (r.changed && r.sliceName) {
        const targetRel = `世界观/切片_${r.sliceName}.md`
        const targetAbs = join(worldDir, `切片_${r.sliceName}.md`)
        const existText = existsSync(targetAbs) ? readFileSync(targetAbs, 'utf-8') : ''
        const willWrite = !existsSync(targetAbs) || isShellSliceFile(existText)
        if (willWrite) {
          const bodyText = r.sliceBody.length ? `\n\n${r.sliceBody.join('\n')}` : ''
          plan.push({ rel: targetRel, action: `写入世界切片（源自总纲切片状态）` })
          toWrite.push({ rel: targetRel, text: `# 切片：${r.sliceName}${bodyText}\n` })
          toWrite.push({ rel: '世界观/总纲.md', text: r.text })
        } else {
          log(`  世界观/总纲.md：切片状态候选存在且非空 → 跳过（人工处理）`)
        }
      } else {
        for (const rep of r.reports) log(`  世界观/总纲.md：${rep}`)
        if (r.changed) toWrite.push({ rel: '世界观/总纲.md', text: r.text })
      }
    }
    // 3. 旧无前缀名世界切片文件 → 新名（旧文件保留）
    for (const f of readdirSync(worldDir)) {
      if (!f.endsWith('.md') || f === '总纲.md' || f.startsWith('切片_')) continue
      const oldAbs = join(worldDir, f)
      const newAbs = join(worldDir, `切片_${f}`)
      const oldText = readFileSync(oldAbs, 'utf-8')
      if (existsSync(newAbs)) {
        const newText = readFileSync(newAbs, 'utf-8')
        if (isShellSliceFile(newText)) {
          plan.push({ rel: `世界观/切片_${f}`, action: `用旧名 ${f} 内容填充空壳` })
          toWrite.push({ rel: `世界观/切片_${f}`, text: oldText })
        } else {
          log(`  世界观/切片_${f}：新名已有内容 → 保留（跳过）`)
        }
      } else {
        plan.push({ rel: `世界观/切片_${f}`, action: `新建（复制旧名 ${f}）` })
        toWrite.push({ rel: `世界观/切片_${f}`, text: oldText })
      }
    }
  }
  if (!plan.length) { log('  无迁移项'); return }
  if (!APPLY) {
    for (const p of plan) log(`  [dry-run] ${p.rel} ← ${p.action}`)
    // 预览改后文本（核对格式后再 apply）
    if (process.argv.includes('--preview')) {
      for (const w of toWrite) {
        log(`  --- 预览 ${w.rel} ---`)
        log(w.text.split('\n').slice(0, 22).join('\n'))
      }
    }
    return
  }
  // apply：备份（改写文件原样复制）→ 写入
  const bak = join(projectDir, '.zhijuan', `migrate-backup-${ts}`)
  for (const w of toWrite) {
    const abs = join(projectDir, w.rel)
    if (existsSync(abs)) {
      const b = join(bak, w.rel)
      mkdirSync(join(b, '..'), { recursive: true })
      copyFileSync(abs, b)
    }
  }
  for (const w of toWrite) {
    mkdirSync(join(projectDir, w.rel, '..'), { recursive: true })
    writeFileSync(join(projectDir, w.rel), w.text, 'utf-8')
  }
  for (const p of plan) log(`  [apply] ${p.rel} ${p.action}`)
  log(`  备份目录：${bak.replace(homedir(), '~')}`)
  // 自校验：迁移后不应再有 H3 切片节
  const bad = []
  for (const w of toWrite) {
    const t = w.text
    if (/^###\s+切片/.test(t) || /^###\s+切片状态/.test(t)) bad.push(w.rel)
  }
  log(bad.length ? `  [校验失败] 残留 H3 切片节：${bad.join(', ')}` : '  [校验 PASS] 无 H3 切片节残留')
}

// ---------- 入口 ----------
const roots = [join(homedir(), 'Documents', '织卷项目库'), join(homedir(), 'Documents', '织卷工作区', '项目库')]
const targets = args.slice(2)
console.log(APPLY ? '迁移模式：APPLY（写盘前备份）' : '迁移模式：DRY-RUN（只读预览，加 --apply 生效）')
if (targets.length) {
  for (const t of targets) { if (existsSync(t)) processProject(t, (s) => console.log(s)) }
} else {
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      const p = join(root, name)
      if (!statSync(p).isDirectory()) continue
      processProject(p, (s) => console.log(s))
    }
  }
}
