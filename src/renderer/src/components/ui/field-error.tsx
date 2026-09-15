import * as React from 'react'
import { cn } from '../../lib/utils'

/** 字段级错误提示（HIG Entering data「provide feedback as soon as you detect a problem」：
 * 对话内表单的校验/操作错误就近展示在出错字段下方，配 aria-invalid 输入红边，
 * 错误常驻到用户修正——取代「右上角 toast 一闪而过、与对话框无关联」的反馈缺口。
 * 语义色走 --color-danger（暖纸·青黛 danger 红），文案「<动作>失败：<原因>」见 文案口径表§三。 */
export const FieldError = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} role="alert" className={cn('mt-1.5 text-xs leading-snug text-danger', className)} {...props} />
  )
)
FieldError.displayName = 'FieldError'

/** 出错输入框的约定类：配合 `aria-invalid={!!err}` 使用（aria-[invalid=true] 命中），
 * danger 描边 + 焦点危险环；其余态与 Input 基础类不冲突。 */
export const fieldInvalidClass =
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/50'
