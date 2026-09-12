import { CheckCircle2, Circle, ListChecks } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import type { TodoItem } from '../../../../shared/types'
import { cn } from '../../lib/utils'

const statusMeta: Record<TodoItem['status'], { label: string; icon: React.ReactNode; cls: string }> = {
  pending: { label: '待办', icon: <Circle className="h-3.5 w-3.5 text-ink-3" />, cls: 'text-ink-2' },
  in_progress: { label: '进行中', icon: <LoadingIndicator size={14} className="text-accent" />, cls: 'text-ink' },
  completed: { label: '完成', icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" />, cls: 'text-ink-3 line-through' }
}

export default function TodoCard({ items }: { items: TodoItem[] }) {
  const done = items.filter((i) => i.status === 'completed').length
  return (
    <div className="rounded-xl border border-hair bg-surface p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <ListChecks className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-medium text-ink">任务清单</span>
        <span className="text-[10px] text-ink-3">
          {done}/{items.length} 完成
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => {
          const st = statusMeta[it.status] ?? statusMeta.pending
          return (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">{st.icon}</span>
              <span className={cn('text-xs leading-5', st.cls)}>{it.content}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
