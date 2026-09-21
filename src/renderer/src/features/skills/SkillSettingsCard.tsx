// ===== 织卷 · 设置页「技能包」管理卡片（体验层 2026-09-21） =====
// 技能=作者沉淀的写作方法/流程资产（工作区 skills/<名>/SKILL.md，开放标准子集）。
// 数据链=智能层 2537580（写面六函数+validateSkillDraft 单一校验闸，UI 任何写入路径都过它，勿另写清洗）；
// 本组件只接线 UI：列表（名称/描述/开关/编辑/导出/删除）+ 新建/编辑 Dialog + 导入/导出（系统文件对话框）。
// 规范：F-20260917-01 按钮三级（「新建技能」=关键行动点带文字；行内编辑/导出/删除=功能点 icon+title/aria）；
//       窄窗不换行（行内 shrink-0）；权限词=技能包（文案口径表）；IME 组合期 Enter 守卫（ime.ts 先例）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Separator } from '../../components/ui/separator'
import { Switch } from '../../components/ui/switch'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { FieldError } from '../../components/ui/field-error'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog'
import { Plus, Trash2, Pencil, FileUp, FileDown, RefreshCw } from 'lucide-react'
import { validateSkillDraft, type SkillMeta, type SkillDraft } from '../../../../shared/skills'
import { isImeComposing } from '../../lib/ime'

/** 编辑 Dialog：新建/编辑共用（名称编辑态锁定——改名=删除+新建，智能层 updateSkill 口径） */
function SkillEditorDialog({
  open,
  editing,
  onOpenChange,
  onSaved
}: {
  open: boolean
  editing: SkillMeta | null
  onOpenChange: (v: boolean) => void
  onSaved: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [when, setWhen] = useState('')
  const [triggers, setTriggers] = useState('')
  const [args, setArgs] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  // 打开时按 editing 预填（编辑=原字段回显；新建=空）
  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setDesc(editing?.description ?? '')
    setWhen(editing?.whenToUse ?? '')
    setTriggers((editing?.triggers ?? []).join(' '))
    setArgs(editing?.arguments ?? '')
    setBody(editing?.body ?? '')
    setErr('')
  }, [open, editing])

  const descriptionLen = desc.trim().length
  const bodyLen = body.length
  const canSave = !saving && name.trim().length > 0 && descriptionLen > 0

  async function save() {
    const draft: SkillDraft = {
      name,
      description: desc,
      whenToUse: when.trim() || undefined,
      triggers: triggers.split(/[\s,，]+/).map((t) => t.trim()).filter(Boolean),
      arguments: args.trim() || undefined,
      disabled: editing?.disabled,
      body
    }
    // 校验唯一闸=validateSkillDraft（名称/描述）；触发词/正文超长只做提示不拦截
    const v = validateSkillDraft(draft)
    if (v) {
      setErr(v)
      return
    }
    setSaving(true)
    const r = editing ? await window.zhijuan.updateSkill(editing.name, draft) : await window.zhijuan.createSkill(draft)
    setSaving(false)
    if (!r.ok) {
      setErr(r.error)
      return
    }
    onOpenChange(false)
    onSaved(draft.name.trim())
  }

  const enterSave = (e: React.KeyboardEvent) => {
    // 单行 Input：Enter=保存（IME 组合期是候选确认，放行）；多行 Textarea 保持换行语义（建章对话框先例）
    if (e.key === 'Enter' && !isImeComposing(e)) {
      e.preventDefault()
      if (canSave) void save()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent outsideDismiss={false} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑技能包《${editing.name}》` : '新建技能包'}</DialogTitle>
          <DialogDescription>
            {editing
              ? '修改内容后保存即生效；技能名不可改（改名请删除后用新名新建）。'
              : '把写作方法/流程沉淀成技能包（SKILL.md）；对话中说触发词或输入 /技能名 即可调用。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="zj-skill-name">技能名（=命令名）</Label>
            <Input
              id="zj-skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={enterSave}
              placeholder="如：倒叙开篇法"
              disabled={!!editing}
            />
            {editing ? (
              <p className="text-xs text-ink-3" role="status">技能名保存后不可改；改名请删除后新建。</p>
            ) : (
              <p className="text-xs text-ink-3">1–64 字符；与 / 命令同名时内置命令优先。</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zj-skill-desc">
              描述（做什么+何时用）
              <span className={descriptionLen > 500 ? 'ml-1 text-danger' : 'ml-1 text-ink-3'}>{descriptionLen}/500</span>
            </Label>
            <Textarea
              id="zj-skill-desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              placeholder="如：从人物高光时刻落笔再回叙起因，制造悬念与代入感。"
              aria-invalid={descriptionLen > 500}
            />
            <p className="text-xs text-ink-3">必填；描述常驻模型上下文（清单展示与自动匹配），写清「什么时候用」。</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="zj-skill-triggers">触发词</Label>
              <Input
                id="zj-skill-triggers"
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
                onKeyDown={enterSave}
                placeholder="空格分隔，如：倒叙 开篇"
              />
              <p className="text-xs text-ink-3">可选；说中任一触发词即自动调用。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zj-skill-args">参数提示</Label>
              <Input
                id="zj-skill-args"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                onKeyDown={enterSave}
                placeholder="如：[要点]"
              />
              <p className="text-xs text-ink-3">可选；显示在 / 命令菜单。</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zj-skill-body">
              正文（步骤/流程）
              <span className={bodyLen > 3000 ? 'ml-1 text-warn' : 'ml-1 text-ink-3'}>{bodyLen} 字符</span>
            </Label>
            <Textarea
              id="zj-skill-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder={'步骤：\n1. 先写人物最高光的一幕\n2. 回叙中埋下呼应细节'}
            />
            <p className="text-xs text-ink-3">建议 ≤3000 字符；超长调用时只注入开头并提示可读完整文件。</p>
          </div>
          {err && <FieldError>{err}</FieldError>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!canSave}>
            {saving ? '保存中…' : editing ? '保存修改' : '创建技能'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function SkillSettingsCard() {
  const [skills, setSkills] = useState<SkillMeta[] | null>(null) // null=读取中
  const [skillsErr, setSkillsErr] = useState('')
  const [msg, setMsg] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<SkillMeta | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const delTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback(async () => {
    setSkillsErr('')
    try {
      setSkills(await window.zhijuan.listSkills())
    } catch {
      setSkills(null)
      setSkillsErr('读取技能包失败')
    }
  }, [])
  useEffect(() => {
    void load()
    return () => clearTimeout(delTimer.current)
  }, [load])

  async function toggleSkill(s: SkillMeta, on: boolean) {
    const r = await window.zhijuan.setSkillDisabled(s.name, !on)
    if (!r.ok) {
      setMsg(r.error)
      return
    }
    await load()
    setMsg(on ? `已启用技能《${s.name}》` : `已停用技能《${s.name}》`)
  }

  async function doDelete(name: string) {
    const r = await window.zhijuan.deleteSkill(name)
    if (!r.ok) {
      setMsg(r.error)
      return
    }
    setConfirmDel(null)
    await load()
    setMsg(`已删除技能《${name}》`)
  }

  function askDelete(name: string) {
    if (confirmDel === name) {
      void doDelete(name)
      return
    }
    setConfirmDel(name)
    clearTimeout(delTimer.current)
    delTimer.current = setTimeout(() => setConfirmDel(null), 3000)
  }

  async function doImport() {
    const r = await window.zhijuan.importSkillPicker()
    if (r.ok) {
      await load()
      setMsg('已导入技能包')
    } else if (!('cancelled' in r) || !r.cancelled) {
      setMsg('error' in r ? (r.error ?? '导入失败') : '导入失败')
    }
  }

  async function doExport(s: SkillMeta) {
    const r = await window.zhijuan.exportSkillFile(s.name)
    if (r.ok) setMsg(`已导出《${s.name}》到 ${r.path}`)
    else if (!('cancelled' in r) || !r.cancelled) setMsg('error' in r ? (r.error ?? '导出失败') : '导出失败')
  }

  return (
    <Card className="mt-4 p-6" data-testid="skill-settings-card">
      <h3 className="text-sm font-semibold text-ink-2">技能包</h3>
      <Separator className="my-4" />
      <p className="pb-3 text-xs text-ink-3">
        把写作方法/流程沉淀为技能包（本地 SKILL.md），对话中按触发词或 /技能名 自动调用。每个技能的描述常驻模型上下文（占用少量预算）——用不上的技能先停用。
      </p>
      {skillsErr ? (
        <div className="flex items-center gap-2 rounded-md border border-hair bg-surface-2 px-3 py-2">
          <span className="flex-1 truncate text-xs text-danger" role="alert">{skillsErr}</span>
          <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => void load()} aria-label="重试读取技能包" title="重试读取技能包">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : skills === null ? (
        <p className="text-xs text-ink-3" role="status">正在读取技能包…</p>
      ) : skills.length === 0 ? (
        <p className="mb-3 text-xs text-ink-3" role="status">还没有技能包——把常用的写作方法沉淀下来，或从别处导入 .md。</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {skills.map((s) => (
            <li key={s.name} className="flex items-center gap-2 rounded-md border border-hair bg-surface-2 px-3 py-2" data-testid="skill-row">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink-2" title={s.name}>{s.name}</span>
                  {s.disabled && <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">已停用</Badge>}
                  {s.invalid && (
                    <Badge variant="warn" className="shrink-0 px-1.5 py-0 text-[10px]" title={s.invalid}>未生效</Badge>
                  )}
                </div>
                <p className="truncate text-xs text-ink-3" title={s.description}>{s.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Switch aria-label={`启用技能 ${s.name}`} checked={!s.disabled} onCheckedChange={(v) => void toggleSkill(s, v)} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`编辑技能 ${s.name}`}
                  title={`编辑技能 ${s.name}`}
                  onClick={() => {
                    setEditing(s)
                    setEditorOpen(true)
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`导出技能 ${s.name}`}
                  title={`导出技能 ${s.name}`}
                  onClick={() => void doExport(s)}
                >
                  <FileDown className="h-3.5 w-3.5" />
                </Button>
                {confirmDel === s.name ? (
                  <Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={() => void doDelete(s.name)}>
                    确认删除
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`删除技能 ${s.name}`}
                    title={`删除技能 ${s.name}`}
                    onClick={() => askDelete(s.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-1">新建技能</span>
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => void doImport()}>
          <FileUp className="h-3.5 w-3.5" />
          <span className="ml-1">导入 .md</span>
        </Button>
      </div>
      {msg && (
        <p className="mt-2 break-all text-xs text-ink-3" role="status">
          {msg}
        </p>
      )}
      <SkillEditorDialog
        open={editorOpen}
        editing={editing}
        onOpenChange={setEditorOpen}
        onSaved={(name) => {
          void load()
          setMsg(`已保存技能《${name}》`)
        }}
      />
    </Card>
  )
}
