import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { leaveCopy, type LeaveReason } from './unsavedGuardCore'

interface Props {
  open: boolean
  reason: LeaveReason
  /** 文案主语（如「这份设定」「这张素材卡」） */
  subject: string
  /** 正在保存（按钮禁用防连点） */
  saving?: boolean
  /** 宿主是否提供了保存通道；无通道时「保存并…」置灰 */
  canSave?: boolean
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}

/**
 * 未保存三选确认弹窗（正文页之外的三处宿主共用）。
 * 形态与 Novel.tsx 的切章/关窗/路由守卫完全一致（同一标题、同一三选顺序、破坏性项 danger 红字）：
 * 取消 / 不保存X / 保存并X；点遮罩不计入数据风险（=取消），但输入类语义下仍按 outsideDismiss=false
 * 与切章守卫保持同形（Esc/取消都是明确取消路径）。
 */
export default function UnsavedLeaveDialog({ open, reason, subject, saving = false, canSave = true, onCancel, onDiscard, onSave }: Props) {
  const t = leaveCopy(reason, subject)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md" outsideDismiss={false} data-testid="unsaved-leave-dialog">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button variant="outline" onClick={onDiscard} className="text-danger" disabled={saving} data-testid="unsaved-discard">
            {t.discardLabel}
          </Button>
          <Button onClick={onSave} disabled={saving || !canSave} title={canSave ? undefined : '编辑器还没就绪，稍后再试'} data-testid="unsaved-save">
            {t.saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}