import { useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, CheckCircle2, Command, Download, LockKeyhole, Search, ShieldCheck, Sparkles, WandSparkles } from 'lucide-react'
import { Builder } from './components/Builder'

const samples = [
  { title: 'مشاركة موقعي', category: 'موقع', description: 'يجلب موقعك الحالي ويحوّله لرابط خرائط جاهز للمشاركة.', icon: '📍' },
  { title: 'فتح رابط سريع', category: 'إنتاجية', description: 'يفتح عنوان URL محدد بخطوة واحدة من شاشة الاختصارات.', icon: '🔗' },
  { title: 'نسخ الوقت الحالي', category: 'أدوات', description: 'يحصل على التاريخ والوقت وينسخه للحافظة مباشرة.', icon: '⏱️' },
  { title: 'بريد جاهز', category: 'تواصل', description: 'ينشئ مسودة بريد بالعنوان والنص ثم يترك الإرسال للمستخدم.', icon: '✉️' },
]

export default function App() {
  const [query, setQuery] = useState('')
  const visible = samples.filter(item => `${item.title} ${item.category} ${item.description}`.includes(query))
  return <div className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="nav container"><a className="brand" href="#top"><span><Command size={20}/></span><b>Shortcut Forge</b></a><nav><a href="#catalog">المكتبة</a><a href="#builder">البناء</a><a href="#security">الأمان</a></nav><a className="btn primary compact" href="#builder">ابدأ البناء <ArrowLeft size={15}/></a></header>
    <main id="top">
      <section className="hero container">
        <motion.div initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} transition={{duration:.55}} className="hero-copy"><div className="badge"><Sparkles size={15}/> صانع اختصارات Apple بالعربي</div><h1>اختصارات أقوى.<br/><span>بدون تعقيد.</span></h1><p>ابنِ Workflow مرئي، رتّب خطواته بالسحب، تحقق منه تلقائيًا، ثم صدّره كملف Shortcut أو JSON.</p><div className="hero-actions"><a className="btn primary big" href="#builder"><WandSparkles size={18}/> ابنِ اختصارك</a><a className="btn ghost big" href="#catalog"><Download size={18}/> تصفح الجاهز</a></div><div className="trust-row"><span><CheckCircle2/>RTL كامل</span><span><CheckCircle2/>حفظ محلي</span><span><CheckCircle2/>Validation</span></div></motion.div>
        <motion.div initial={{opacity:0,scale:.96}} animate={{opacity:1,scale:1}} transition={{duration:.55,delay:.08}} className="hero-demo"><div className="demo-bar"><i/><i/><i/><span>Workflow Preview</span></div><div className="demo-step active"><b>01</b><span>📍 الموقع الحالي</span><small>Get Current Location</small></div><div className="demo-line"/><div className="demo-step"><b>02</b><span>🗺️ رابط خرائط</span><small>Maps Link</small></div><div className="demo-line"/><div className="demo-step"><b>03</b><span>📋 نسخ للحافظة</span><small>Copy to Clipboard</small></div><div className="demo-footer"><ShieldCheck/>التحقق ناجح</div></motion.div>
      </section>
      <section id="catalog" className="catalog container"><div className="section-heading"><div><span className="eyebrow">Ready Shortcuts</span><h2>ابدأ من قالب جاهز</h2></div><label className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث في الاختصارات"/></label></div><div className="cards">{visible.map(item => <article className="shortcut-card" key={item.title}><div className="shortcut-icon">{item.icon}</div><span className="category">{item.category}</span><h3>{item.title}</h3><p>{item.description}</p><button className="text-button" onClick={()=>document.querySelector('#builder')?.scrollIntoView({behavior:'smooth'})}>استخدم كفكرة <ArrowLeft size={15}/></button></article>)}</div></section>
      <div className="container"><Builder/></div>
      <section id="security" className="security container"><div><span className="eyebrow">Apple Security Model</span><h2>واضح من البداية.</h2><p>Shortcut Forge يولّد الـworkflow ويجهزه للتوقيع، لكنه لا يتجاوز حماية Apple ولا يثبت اختصارًا بصمت على جهاز المستخدم.</p></div><div className="security-grid"><div><LockKeyhole/><h3>التوقيع منفصل</h3><p>التوقيع العام يتم على macOS بواسطة أداة Shortcuts الرسمية.</p></div><div><ShieldCheck/><h3>موافقة المستخدم</h3><p>المستخدم يظل صاحب قرار إضافة الاختصار ومنح صلاحياته.</p></div><div><Command/><h3>منطق مستقل</h3><p>مولّد plist منفصل عن طبقة التصميم، لذلك تطوير الواجهة لا يكسر التوليد.</p></div></div></section>
    </main>
    <footer className="container footer"><div className="brand"><span><Command size={18}/></span><b>Shortcut Forge</b></div><p>بُني ليكون سريعًا، عربيًا، وقابلًا للتوسعة.</p></footer>
  </div>
}