import ctypes,json,math,os,queue,subprocess,tempfile,threading,time,urllib.request,winreg
from ctypes import wintypes
from pathlib import Path
import tkinter as tk
from tkinter import ttk,messagebox
import dxcam,numpy as np,vgamepad as vg

NAME='Panda Training Standalone'; VER='1.0.0'
DATA=Path(os.getenv('APPDATA',Path.home()))/'PandaTrainingStandalone'; CFG=DATA/'config.json'
VIGEM='https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe'
HIDE='https://github.com/nefarius/HidHide/releases/download/v1.5.230.0/HidHide_1.5.230_x64.exe'
PRE={'red':[[0,130,130,10,255,255],[170,130,130,179,255,255]],'purple':[[125,80,80,165,255,255]],'yellow':[[18,120,120,38,255,255]],'green':[[40,90,90,90,255,255]]}
DEF={'preset':'red','fov':170,'dead':4,'min_area':18,'max_area':12000,'kernel':3,'smooth':.42,'strength':.23,'max_corr':7500,'yoff':-.10,'conf':18,'ads':45,'fps':120,'slot':0,'enabled':True}
BMAP=[(1,'XUSB_GAMEPAD_DPAD_UP'),(2,'XUSB_GAMEPAD_DPAD_DOWN'),(4,'XUSB_GAMEPAD_DPAD_LEFT'),(8,'XUSB_GAMEPAD_DPAD_RIGHT'),(16,'XUSB_GAMEPAD_START'),(32,'XUSB_GAMEPAD_BACK'),(64,'XUSB_GAMEPAD_LEFT_THUMB'),(128,'XUSB_GAMEPAD_RIGHT_THUMB'),(256,'XUSB_GAMEPAD_LEFT_SHOULDER'),(512,'XUSB_GAMEPAD_RIGHT_SHOULDER'),(4096,'XUSB_GAMEPAD_A'),(8192,'XUSB_GAMEPAD_B'),(16384,'XUSB_GAMEPAD_X'),(32768,'XUSB_GAMEPAD_Y')]
def cl(v,a,b): return max(a,min(b,v))
def svc(n):
 try:
  with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,rf'SYSTEM\CurrentControlSet\Services\{n}'): return True
 except OSError:return False
def load():
 DATA.mkdir(parents=True,exist_ok=True); d=dict(DEF)
 try:d.update(json.loads(CFG.read_text(encoding='utf8')))
 except:pass
 return d
def save(d):DATA.mkdir(parents=True,exist_ok=True);CFG.write_text(json.dumps(d,indent=2),encoding='utf8')
def admin(exe,args):return ctypes.windll.shell32.ShellExecuteW(None,'runas',str(exe),args,None,1)>32
def dl(u,p):
 r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'PandaTraining/1.0'}),timeout=60)
 with r,open(p,'wb') as f:
  while 1:
   b=r.read(262144)
   if not b:break
   f.write(b)
def open_hide():
 for p in [Path(os.getenv('ProgramFiles',r'C:\Program Files'))/'Nefarius Software Solutions'/'HidHide'/'HidHideClient.exe',Path(os.getenv('ProgramFiles',r'C:\Program Files'))/'Nefarius Software Solutions e.U'/'HidHide'/'HidHideClient.exe']:
  if p.exists():subprocess.Popen([str(p)]);return True
 return False
class GP(ctypes.Structure):_fields_=[('wButtons',wintypes.WORD),('bLeftTrigger',wintypes.BYTE),('bRightTrigger',wintypes.BYTE),('sThumbLX',wintypes.SHORT),('sThumbLY',wintypes.SHORT),('sThumbRX',wintypes.SHORT),('sThumbRY',wintypes.SHORT)]
class ST(ctypes.Structure):_fields_=[('dwPacketNumber',wintypes.DWORD),('Gamepad',GP)]
def xdll():
 for n in ('xinput1_4.dll','xinput9_1_0.dll','xinput1_3.dll'):
  try:
   x=ctypes.WinDLL(n);x.XInputGetState.argtypes=[wintypes.DWORD,ctypes.POINTER(ST)];x.XInputGetState.restype=wintypes.DWORD;return x
  except:pass
 raise RuntimeError('XInput not found')
class Bridge:
 def __init__(s,slot):s.slot=slot;s.x=xdll();s.v=vg.VX360Gamepad()
 def read(s):
  st=ST();return st if s.x.XInputGetState(s.slot,ctypes.byref(st))==0 else None
 def write(s,st,cx=0,cy=0):
  g=st.Gamepad
  for m,n in BMAP:
   b=getattr(vg.XUSB_BUTTON,n);s.v.press_button(button=b) if g.wButtons&m else s.v.release_button(button=b)
  s.v.left_trigger(value=int(g.bLeftTrigger));s.v.right_trigger(value=int(g.bRightTrigger));s.v.left_joystick(x_value=int(g.sThumbLX),y_value=int(g.sThumbLY));s.v.right_joystick(x_value=int(cl(g.sThumbRX+cx,-32768,32767)),y_value=int(cl(g.sThumbRY+cy,-32768,32767)));s.v.update()
 def reset(s):
  try:s.v.reset();s.v.update()
  except:pass
class Vision:
 def __init__(s,c):s.c=c;s.cam=None;s.sx=s.sy=0
 def start(s):
  try:ctypes.windll.user32.SetProcessDPIAware()
  except:pass
  s.cam=dxcam.create(output_color='BGR')
 def mask(s,fr):
  b=fr[:,:,0].astype(np.int16);g=fr[:,:,1].astype(np.int16);r=fr[:,:,2].astype(np.int16);p=s.c['preset']
  if p=='purple':return (r>120)&(b>120)&(g<170)&((r+b-g)>150)
  if p=='yellow':return (r>170)&(g>150)&(b<140)&((r+g-b)>260)
  if p=='green':return (g>150)&(g>r*1.08)&(g>b*1.08)
  return (r>155)&(r>g*1.25)&(r>b*1.25)
 def target(s):
  c=s.c;f=int(cl(c['fov'],30,600));u=ctypes.windll.user32;w,h=u.GetSystemMetrics(0),u.GetSystemMetrics(1);x,y=w//2,h//2;fr=s.cam.grab(region=(max(0,x-f),max(0,y-f),min(w,x+f),min(h,y+f)))
  if fr is None:return 0,0,0,False
  m=s.mask(fr);ys,xs=np.nonzero(m);cnt=len(xs)
  if cnt<int(c['min_area']):s.sx*=.65;s.sy*=.65;return 0,0,0,False
  cx,cy=fr.shape[1]/2,fr.shape[0]/2;d2=(xs-cx)**2+(ys-cy)**2;i=int(np.argmin(d2));px,py=xs[i],ys[i];rad=max(8,int(c['kernel'])*4);near=(np.abs(xs-px)<=rad)&(np.abs(ys-py)<=rad);area=int(near.sum())
  if area<int(c['min_area']) or area>int(c['max_area']):return 0,0,0,False
  tx=float(xs[near].mean());ty=float(ys[near].mean())+rad*c['yoff'];dx,dy=tx-cx,ty-cy;di=math.hypot(dx,dy)
  if di>f:return 0,0,0,False
  a=cl(c['smooth'],.01,1);s.sx+=(dx-s.sx)*a;s.sy+=(dy-s.sy)*a;dx=0 if abs(s.sx)<=c['dead'] else s.sx;dy=0 if abs(s.sy)<=c['dead'] else s.sy;mx=int(cl(c['max_corr'],100,20000));ox=int(cl(dx/f*32767*c['strength'],-mx,mx));oy=int(cl(-dy/f*32767*c['strength'],-mx,mx));cf=int(cl(max(0,1-di/f)*80+min(1,area/80)*20,0,100));return (ox,oy,cf,True) if cf>=c['conf'] else (0,0,cf,False)
class Run(threading.Thread):
 def __init__(s,c,q):super().__init__(daemon=True);s.c=c;s.q=q;s.stop=threading.Event();s.lock=threading.Lock()
 def upd(s,c):
  with s.lock:s.c=dict(c)
 def run(s):
  b=v=None
  try:
   with s.lock:c=dict(s.c)
   b=Bridge(c['slot']);v=Vision(c);v.start();s.q.put(('status','Running'));n=0;t=time.perf_counter();fps=0
   while not s.stop.is_set():
    with s.lock:c=dict(s.c);v.c=c
    st=b.read()
    if not st:s.q.put(('tele',(False,False,0,0,0,fps)));time.sleep(.15);continue
    ads=st.Gamepad.bLeftTrigger>=c['ads'];ox=oy=cf=0;found=False
    if c['enabled'] and ads:ox,oy,cf,found=v.target()
    b.write(st,ox,oy);n+=1;now=time.perf_counter()
    if now-t>=.5:fps=n/(now-t);n=0;t=now;s.q.put(('tele',(True,ads,found,cf,ox,oy,fps)))
    time.sleep(1/max(60,c['fps']*4))
  except Exception as e:s.q.put(('err',str(e)))
  finally:
   if b:b.reset()
   s.q.put(('status','Stopped'))
class App(tk.Tk):
 F=[('preset','Target color','combo'),('fov','FOV radius','int'),('dead','Deadzone px','int'),('min_area','Min target area','int'),('max_area','Max target area','int'),('kernel','Noise filter','int'),('smooth','Smoothing','float'),('strength','Correction strength','float'),('max_corr','Max right-stick correction','int'),('yoff','Vertical offset','float'),('conf','Min confidence','int'),('ads','ADS threshold','int'),('fps','Capture FPS','int'),('slot','XInput slot','int')]
 def __init__(s):super().__init__();s.title(f'{NAME} {VER}');s.geometry('720x690');s.c=load();s.q=queue.Queue();s.w=None;s.v={};s.protocol('WM_DELETE_WINDOW',s.close);s.ui();s.pull();s.deps();s.after(100,s.poll)
 def ui(s):
  r=ttk.Frame(s,padding=16);r.pack(fill='both',expand=True);ttk.Label(r,text=NAME,font=('Segoe UI',20,'bold')).pack(anchor='w');ttk.Label(r,text='One-click screen CV + virtual Xbox bridge (training/offline).').pack(anchor='w',pady=(2,12))
  d=ttk.LabelFrame(r,text='System check',padding=10);d.pack(fill='x');s.dv=ttk.Label(d);s.dv.grid(row=0,column=0,sticky='w');s.dh=ttk.Label(d);s.dh.grid(row=1,column=0,sticky='w');ttk.Button(d,text='Install / Repair drivers',command=s.install).grid(row=0,column=1,rowspan=2,padx=8);ttk.Button(d,text='Open HidHide',command=lambda:open_hide() or messagebox.showinfo(NAME,'Install HidHide first.')).grid(row=0,column=2,rowspan=2);d.columnconfigure(0,weight=1)
  z=ttk.LabelFrame(r,text='Run',padding=10);z.pack(fill='x',pady=10);s.st=tk.StringVar(value='Stopped');s.tm=tk.StringVar(value='Controller: -- | Target: -- | FPS: --');ttk.Label(z,textvariable=s.st,font=('Segoe UI',11,'bold')).grid(row=0,column=0,sticky='w');ttk.Label(z,textvariable=s.tm).grid(row=1,column=0,sticky='w');s.bs=ttk.Button(z,text='START',command=s.start);s.bs.grid(row=0,column=1,rowspan=2,padx=8,ipadx=16);s.bp=ttk.Button(z,text='STOP',command=s.stop,state='disabled');s.bp.grid(row=0,column=2,rowspan=2,ipadx=16);z.columnconfigure(0,weight=1)
  f=ttk.LabelFrame(r,text='Settings',padding=10);f.pack(fill='both',expand=True)
  for i,(k,l,t) in enumerate(s.F):
   ttk.Label(f,text=l).grid(row=i,column=0,sticky='w',pady=3);v=tk.StringVar();s.v[k]=(v,t);w=ttk.Combobox(f,textvariable=v,values=['red','purple','yellow','green'],state='readonly') if t=='combo' else ttk.Entry(f,textvariable=v);w.grid(row=i,column=1,sticky='ew',pady=3,padx=(12,0))
  s.en=tk.BooleanVar();ttk.Checkbutton(f,text='Enable screen correction only while ADS is held',variable=s.en).grid(row=len(s.F),column=0,columnspan=2,sticky='w',pady=8);ttk.Label(f,text='Left stick is passed through unchanged; screen correction is added only to Right Stick.',wraplength=610).grid(row=len(s.F)+1,column=0,columnspan=2,sticky='w');f.columnconfigure(1,weight=1)
  b=ttk.Frame(r);b.pack(fill='x',pady=(10,0));ttk.Button(b,text='Reset defaults',command=s.reset).pack(side='left');ttk.Button(b,text='Open data folder',command=lambda:(DATA.mkdir(parents=True,exist_ok=True),os.startfile(DATA))).pack(side='left',padx=8);ttk.Button(b,text='Save settings',command=s.save).pack(side='right')
 def pull(s):
  for k,(v,t) in s.v.items():v.set(str(s.c[k]));s.en.set(s.c['enabled'])
 def get(s):
  d=dict(s.c)
  for k,(v,t) in s.v.items():d[k]=int(v.get()) if t=='int' else float(v.get()) if t=='float' else v.get()
  d['enabled']=s.en.get();d['fov']=int(cl(d['fov'],30,600));d['kernel']=int(cl(d['kernel'],1,11));d['kernel']+=d['kernel']%2==0;d['smooth']=cl(d['smooth'],.01,1);d['strength']=cl(d['strength'],.01,1);d['max_corr']=int(cl(d['max_corr'],100,20000));d['conf']=int(cl(d['conf'],0,100));d['ads']=int(cl(d['ads'],0,255));d['fps']=int(cl(d['fps'],30,240));d['slot']=int(cl(d['slot'],0,3));return d
 def save(s,quiet=False):
  try:s.c=s.get();save(s.c);s.w and s.w.upd(s.c);return True if quiet else messagebox.showinfo(NAME,'Settings saved.')
  except Exception as e:messagebox.showerror(NAME,f'Invalid setting: {e}');return False
 def reset(s):s.c=dict(DEF);save(s.c);s.pull();s.w and s.w.upd(s.c)
 def deps(s):s.dv.config(text=f"ViGEmBus: {'READY' if svc('ViGEmBus') else 'MISSING'}");s.dh.config(text=f"HidHide: {'READY' if svc('HidHide') else 'OPTIONAL / MISSING'}")
 def install(s):
  def go():
   try:
    p=Path(tempfile.mkdtemp())
    if not svc('ViGEmBus'):s.q.put(('status','Downloading ViGEmBus...'));a=p/'vigem.exe';dl(VIGEM,a);admin(a,'/qn');time.sleep(3)
    if not svc('HidHide'):s.q.put(('status','Downloading HidHide...'));a=p/'hide.exe';dl(HIDE,a);admin(a,'/install /quiet')
    s.q.put(('drivers',None))
   except Exception as e:s.q.put(('err',f'Driver setup: {e}'))
  threading.Thread(target=go,daemon=True).start()
 def start(s):
  if s.w and s.w.is_alive():return
  if s.save(True) is False:return
  if not svc('ViGEmBus'):messagebox.showwarning(NAME,'Install ViGEmBus first.');return
  s.w=Run(s.c,s.q);s.w.start();s.bs.config(state='disabled');s.bp.config(state='normal');s.st.set('Starting...')
 def stop(s):
  if s.w:s.w.stop.set();s.w=None
  s.bs.config(state='normal');s.bp.config(state='disabled');s.st.set('Stopped')
 def poll(s):
  try:
   while 1:
    k,p=s.q.get_nowait()
    if k=='status':s.st.set(p)
    elif k=='tele':
     if len(p)==6:p=(*p,0)
     co,ads,fo,cf,x,y,fps=p;s.tm.set(f"Controller: {'OK' if co else 'NOT FOUND'} | ADS: {'ON' if ads else 'OFF'} | Target: {'LOCK' if fo else '--'} {cf}% | Corr: {x}/{y} | FPS: {fps:.0f}")
    elif k=='err':s.stop();messagebox.showerror(NAME,p)
    elif k=='drivers':s.deps();s.st.set('Driver setup finished; reboot if HidHide requests it.');messagebox.showinfo(NAME,'Driver setup launched. Reboot Windows once if HidHide asks, then reopen this EXE.')
  except queue.Empty:pass
  s.after(100,s.poll)
 def close(s):s.w and s.w.stop.set();s.destroy()
if __name__=='__main__':App().mainloop()
