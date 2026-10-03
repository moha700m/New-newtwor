import type { ShortcutAction } from '../types'
import { useWorkflow } from '../store/workflow'
import { GripVertical, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/react/sortable'

export function ActionEditor({ action, index }: { action: ShortcutAction; index: number }) {
  const update = useWorkflow(s => s.update)
  const remove = useWorkflow(s => s.remove)
  const sortable = useSortable({ id: action.id, index })
  return (
    <article ref={sortable.ref} className={`action-card ${sortable.isDragging ? 'is-dragging' : ''}`}>
      <button className="drag-handle" aria-label="اسحب لإعادة الترتيب"><GripVertical size={18} /></button>
      <div className="action-main">
        <div className="action-title-row"><strong>{index + 1}. {action.title}</strong><span className="kind-pill">{action.kind}</span></div>
        {action.kind === 'text' && <textarea value={action.value ?? ''} onChange={e => update(action.id, { value: e.target.value })} placeholder="اكتب النص" />}
        {action.kind === 'url' && <input dir="ltr" value={action.value ?? ''} onChange={e => update(action.id, { value: e.target.value })} placeholder="https://" />}
        {action.kind === 'email' && <div className="field-grid">
          <input dir="ltr" value={action.recipient ?? ''} onChange={e => update(action.id, { recipient: e.target.value })} placeholder="email@example.com" />
          <input value={action.subject ?? ''} onChange={e => update(action.id, { subject: e.target.value })} placeholder="الموضوع" />
          <textarea value={action.body ?? ''} onChange={e => update(action.id, { body: e.target.value })} placeholder="نص الرسالة" />
          <small>يفتح Shortcuts نافذة إنشاء البريد للمستخدم قبل الإرسال.</small>
        </div>}
      </div>
      <button className="icon danger" onClick={() => remove(action.id)} aria-label="حذف الخطوة"><Trash2 size={17} /></button>
    </article>
  )
}