import { useMemo, useRef, useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { Braces, ClipboardCopy, Download, FileJson, LocateFixed, Mail, Map, MessageSquareText, RotateCcw, Sparkles, TextCursorInput, Upload, ExternalLink, CalendarClock } from 'lucide-react'
import { ActionEditor } from './ActionEditor'
import { useWorkflow } from '../store/workflow'
import type { ActionKind, Workflow } from '../types'
import { downloadText, generateShortcutPlist, parsePrompt, validateWorkflow } from '../lib/shortcut'

const palette: Array<{kind: ActionKind; label: string; icon: typeof Braces}> = [
  { kind: 'text', label: 'نص', icon: TextCursorInput }, { kind: 'url', label: 'رابط', icon: Braces }, { kind: 'openUrl', label: 'فتح URL', icon: ExternalLink }, { kind: 'location', label: 'الموقع الحالي', icon: LocateFixed }, { kind: 'mapsLink', label: 'رابط خرائط', icon: Map }, { kind: 'date', label: 'التاريخ والوقت', icon: CalendarClock }, { kind: 'clipboard', label: 'الحافظة', icon: ClipboardCopy }, { kind: 'showResult', label: 'عرض نتيجة', icon: MessageSquareText }, { kind: 'email', label: 'بريد', icon: Mail },
]

export function Builder() {
  const { name, actions, setName, add, addMany, move, clear, importWorkflow } = useWorkflow()
  const [prompt, setPrompt] = useState('')
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const validation = useMemo(() => validateWorkflow({ name, actions }), [name, actions])
  const exportShortcut = () => {
    try { downloadText(`${name || 'shortcut'}.shortcut`, generateShortcutPlist({ name, actions })); setMessage('تم إنشاء ملف الاختصار. يحتاج توقيع Apple على macOS للاستيراد العام.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر التصدير') }
  }
  const exportJson = () => downloadText(`${name || 'workflow'}.json`, JSON.stringify({ name, actions }, null, 2), 'application/json')
  const importJson = async (file?: File) => {
    if (!file) return
    try { const parsed = JSON.parse(await file.text()) as Workflow; const valid = validateWorkflow(parsed); if (!valid.success) throw new Error(valid.error.issues[0]?.message ?? 'ملف غير صالح'); importWorkflow(parsed); setMessage('تم استيراد الـWorkflow بنجاح.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'ملف JSON غير صالح') }
  }
  return (
    <section id="builder" className="builder-shell">
      <div className="section-heading"><div><span className="eyebrow">Visual Builder</span><h2>ابنِ الاختصار خطوة بخطوة</h2></div><div className="toolbar"><button className="btn ghost" onClick={exportJson}><FileJson size={16}/> تصدير JSON</button><button className="btn ghost" onClick={() => fileRef.current?.click()}><Upload size={16}/> استيراد</button><input ref={fileRef} className="sr-only" type="file" accept="application/json" onChange={e => importJson(e.target.files?.[0])}/><button className="btn ghost danger-text" onClick={clear}><RotateCcw size={16}/> مسح</button></div></div>
      <div className="builder-grid">
        <aside className="panel palette-panel"><div className="panel-head"><strong>المكتبة</strong><span>{palette.length} إجراءات</span></div><div className="palette-grid">{palette.map(item => <button key={item.kind} className="palette-item" onClick={() => add(item.kind)}><item.icon size={19}/><span>{item.label}</span><b>+</b></button>)}</div><div className="prompt-box"><label><Sparkles size={16}/> مساعد أوامر عربي</label><textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="مثال: افتح https://openai.com ثم اعرض النتيجة" /><button className="btn secondary" onClick={() => { const parsed = parsePrompt(prompt); addMany(parsed); setMessage(parsed.length ? `تمت إضافة ${parsed.length} خطوات.` : 'لم أتعرف على أمر مدعوم.'); }}>تحويل إلى خطوات</button><small>Parser محلي deterministic — بدون ادعاء AI.</small></div></aside>
        <main className="panel canvas-panel"><div className="panel-head canvas-title"><div><span>اسم الاختصار</span><input value={name} onChange={e => setName(e.target.value)} /></div><span className={`status ${validation.success ? 'ok' : 'warn'}`}>{validation.success ? 'جاهز للتصدير' : 'يحتاج إعداد'}</span></div><DragDropProvider onDragEnd={event => { if (event.canceled) return; const { source } = event.operation; if (isSortable(source) && source.initialIndex !== source.index) move(source.initialIndex, source.index) }}><div className="action-list">{actions.length ? actions.map((action, index) => <ActionEditor key={action.id} action={action} index={index}/>) : <div className="empty-state"><Sparkles size={28}/><h3>ابدأ بإضافة أول خطوة</h3><p>اختر إجراء من المكتبة. تقدر تعيد ترتيب الخطوات بالسحب.</p></div>}</div></DragDropProvider></main>
        <aside className="panel export-panel"><div className="panel-head"><strong>التصدير</strong><span>.shortcut</span></div><div className="metric"><span>عدد الإجراءات</span><b>{actions.length}</b></div><div className="metric"><span>التحقق</span><b>{validation.success ? 'سليم' : 'غير مكتمل'}</b></div><button className="btn primary big" disabled={!validation.success} onClick={exportShortcut}><Download size={18}/> تنزيل Shortcut</button><div className="notice"><strong>توقيع Apple</strong><p>الملف المولّد يحتاج التوقيع على macOS باستخدام Apple Shortcuts CLI لكي يصبح مناسبًا للتوزيع العام. الموقع لا يدّعي تثبيتًا صامتًا.</p></div>{message && <div className="message" role="status">{message}</div>}</aside>
      </div>
    </section>
  )
}