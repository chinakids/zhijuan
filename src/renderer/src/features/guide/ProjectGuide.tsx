import { useState } from 'react'
import { Globe2, Users, PartyPopper, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../../components/ui/dialog'
import { sanitizeFile } from '../../../../shared/paths'

interface CharRow {
  name: string
  role: string
  traits: string
}

interface Props {
  projectId: string
  projectName: string
  open: boolean
  onClose: (completed: boolean) => void
}

const steps = [
  { icon: Globe2, label: '世界观设定' },
  { icon: Users, label: '主要角色' },
  { icon: PartyPopper, label: '完成' }
]

/** 角色档案模板（正文保存时切片同步会把各章新状态补进成长轨迹） */
function charDoc(name: string, role: string, traits: string): string {
  return (
    `# ${name}\n\n` +
    `> 定位：${role}\n` +
    `> 关键特征：${traits}\n\n` +
    `## 基础档案\n\n` +
    `（年龄 / 外貌 / 背景 / 性格取向，按需补写）\n\n` +
    `## 成长轨迹（按时间切片）\n\n` +
    `<!-- 正文保存时，切片同步会把 TA 在本章的新状态补进对应小节。 -->\n`
  )
}

/** 世界总纲：引导时大概率还是空模板，直接生成结构；如有已有内容则保留并仅附注 */
function worldDoc(world: { background: string; tone: string; rules: string }, keepOriginal: boolean): string {
  const block = (h: string, v: string) => `## ${h}\n\n${v.trim() || `（待补充）`}\n`
  return (
    `# 世界观总纲\n\n` +
    `> 本节由项目引导创建；各章节的切片世界见 \`世界观/切片_xxx.md\`。\n\n` +
    block('时代背景', world.background) +
    block('世界基调', world.tone) +
    block('核心设定要点', world.rules) +
    `## 时间线总纲\n\n（本作品的故事时间线。每个章节 = 一个时间切片，切片名写在该章正文的约定头里。）\n\n` +
    `## 目录约定\n\n` +
    `- 正文：\`正文/第NN章_题名.md\`，每章开头有一段 front matter（章号/题名/切片/涉及人物）。\n` +
    `- 人物：每角色一个 \`人物/<角色名>.md\`，基础设定 + 按切片的状态小节。\n` +
    `- 世界观：\`世界观/总纲.md\` + 每个切片的 \`世界观/切片_切片名.md\`。\n` +
    `- 素材库：按类别目录存放素材文档；联网采集的原始任务在 \`素材库/采集池/\`。\n` +
    (keepOriginal ? '' : `- 工具数据（提案、会话）在 \`.zhijuan/\`，不是设定本体。\n`)
  )
}

export default function ProjectGuide({ projectId, projectName, open, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [changed, setChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [world, setWorld] = useState({ background: '', tone: '', rules: '' })
  const [chars, setChars] = useState<CharRow[]>([{ name: '', role: '', traits: '' }])

  if (!open) return null

  async function finish() {
    if (saving) return
    setSaving(true)
    try {
      await window.zhijuan.writeDoc(projectId, '世界观/总纲.md', worldDoc(world, false))
      for (const r of chars) {
        if (!r.name.trim()) continue
        const nm = sanitizeFile(r.name.trim())
        await window.zhijuan.writeDoc(projectId, `人物/${nm}.md`, charDoc(nm, r.role.trim(), r.traits.trim()))
      }
      setChanged(true)
      setStep(2)
    } finally {
      setSaving(false)
    }
  }

  const addRow = () => setChars((cs) => [...cs, { name: '', role: '', traits: '' }])
  const patchRow = (i: number, k: keyof CharRow, v: string) =>
    setChars((cs) => cs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))
  const delRow = (i: number) =>
    setChars((cs) => (cs.length === 1 ? [{ name: '', role: '', traits: '' }] : cs.filter((_, idx) => idx !== i)))

  return (
    <Dialog open onOpenChange={(v) => !v && !changed && onClose(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>开始《{projectName}》</DialogTitle>
          {/* 步骤指示 */}
          <div className="flex items-center gap-2 pt-2">
            {steps.map((s, i) => {
              const Icon = s.icon
              const active = i === step
              const done = i < step
              return (
                <div key={s.label} className="flex flex-1 flex-col items-center gap-1">
                  <div className={cnStep(active, done)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span className={`text-[10px] ${active ? 'text-accent' : done ? 'text-ink-2' : 'text-ink-3'}`}>{s.label}</span>
                </div>
              )
            })}
          </div>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-3 py-2">
            <DialogDescription>
              先把世界立住，后面写人和写章都从这里取粮。可以先写要点，以后再细化。
            </DialogDescription>
            <div className="space-y-1.5">
              <Label>时代背景</Label>
              <Textarea rows={2} placeholder="如：近未来的柳城，科技与旧城交错，霓虹镇着一条古河。" value={world.background} onChange={(e) => setWorld((w) => ({ ...w, background: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>世界基调</Label>
              <Textarea rows={2} placeholder="如：潮湿、克制，带着一点旧物件的温度。" value={world.tone} onChange={(e) => setWorld((w) => ({ ...w, tone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>核心设定要点</Label>
              <Textarea rows={3} placeholder={'每条一行：如\n· 灯塔每晚入夜亮起，第二天清晨熄灭\n· 出海的人用灯语报平安\n· 灯光是这个世界唯一还能相信的东西'} value={world.rules} onChange={(e) => setWorld((w) => ({ ...w, rules: e.target.value }))} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3 py-2">
            <DialogDescription>
              列几个主要角色。每人一个档案文件，之后正文保存时会按切片补进成长轨迹。
            </DialogDescription>
            {chars.map((r, i) => (
              <div key={i} className="rounded-lg border border-hair bg-surface-2 p-2.5">
                <div className="flex items-center gap-2">
                  <Input className="flex-1" placeholder="姓名 *" value={r.name} onChange={(e) => patchRow(i, 'name', e.target.value)} />
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="删除该角色" onClick={() => delRow(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input placeholder="在故事里的身份" value={r.role} onChange={(e) => patchRow(i, 'role', e.target.value)} />
                  <Input placeholder="关键特征" value={r.traits} onChange={(e) => patchRow(i, 'traits', e.target.value)} />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full border-dashed" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" /> 加一个角色
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="py-2 text-sm">
            <p className="flex items-center gap-2 text-ink"><PartyPopper className="h-4 w-4 text-accent" /> 创作物料就位</p>
            <ul className="mt-2 list-disc pl-5 text-[13px] text-ink-2">
              <li>世界观写入了 <code>世界观/总纲.md</code></li>
              <li>{chars.filter((c) => c.name.trim()).length} 个角色的档案已生成</li>
              <li>接下来去「正文创作」新建第一章：填好本章要素即可开写</li>
            </ul>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between">
          <div className="flex-1 text-left">
            {step < 2 && (
              <Button variant="ghost" size="sm" onClick={() => onClose(false)}>以后补充</Button>
            )}
          </div>
          <div className="flex gap-2">
            {step > 0 && step < 2 && (
              <Button variant="outline" size="sm" onClick={() => setStep(step - 1)}>上一步</Button>
            )}
            {step === 0 && (
              <Button size="sm" onClick={() => setStep(1)}>下一步：主要角色</Button>
            )}
            {step === 1 && (
              <Button size="sm" onClick={() => void finish()} disabled={saving}>{saving ? '写入中…' : '完成，进入正文'}</Button>
            )}
            {step === 2 && (
              <Button size="sm" onClick={() => onClose(true)}>知道了，开始写</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function cnStep(active: boolean, done: boolean): string {
  return [
    'flex h-7 w-7 items-center justify-center rounded-full border transition-colors',
    active ? 'border-accent bg-accent-soft text-accent' : done ? 'border-hair bg-surface text-ink-2' : 'border-hair bg-surface text-ink-3'
  ].join(' ')
}
