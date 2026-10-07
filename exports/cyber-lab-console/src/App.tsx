import { useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Globe2,
  Laptop,
  Network,
  Radar,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Wifi,
  Smartphone,
  KeyRound,
  Lock,
} from 'lucide-react';

type Agent = {
  id: string;
  name: string;
  platform: string;
  createdAt: number;
  lastSeen: number;
};
type Finding = {
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
};
type ScanResult = {
  id: string;
  agentId: string;
  module: string;
  target: string;
  createdAt: number;
  completedAt: number;
  result: Record<string, unknown>;
};
type MobileDevice = {
  id: string;
  name: string;
  model: string;
  systemName: string;
  systemVersion: string;
  appVersion: string;
  batteryLevel: number;
  batteryState: string;
  lowPowerMode: boolean;
  freeBytes: number;
  totalBytes: number;
  network: string;
  createdAt: number;
  lastSeen: number;
};

type MdmDevice = {
  id: string;
  enrollmentId: string;
  deviceName: string;
  model: string;
  osVersion: string;
  serialNumber: string;
  supervised: boolean;
  status: string;
  lastSeen: number;
};

type MdmCommand = {
  id: string;
  deviceId: string;
  enrollmentId: string;
  command: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  result?: Record<string, unknown>;
};

type Gateway = {
  id: string;
  name: string;
  version: string;
  lastSeen: number;
};

type Tab = 'overview' | 'assess' | 'agents' | 'results' | 'apple';

const الأدوات = [
  {
    id: 'port_scan',
    name: 'فحص المنافذ',
    desc: 'المنافذ والخدمات المفتوحة',
    icon: Network,
  },
  {
    id: 'lan_discover',
    name: 'اكتشاف الشبكة',
    desc: 'اكتشاف أجهزة الشبكة الخاصة /24',
    icon: Radar,
  },
  {
    id: 'http_audit',
    name: 'أمان HTTP',
    desc: 'الترويسات وحالة الخادم',
    icon: Globe2,
  },
  {
    id: 'tls_audit',
    name: 'فحص TLS',
    desc: 'الإصدار والتشفير والشهادة',
    icon: ShieldCheck,
  },
  {
    id: 'system_info',
    name: 'معلومات الجهاز',
    desc: 'النظام وعناوين الشبكة',
    icon: Laptop,
  },
] as const;

const MDM_LABELS: Record<string, string> = {
  DeviceInformation: 'معلومات الجهاز',
  SecurityInfo: 'حالة الأمان',
  ProfileList: 'ملفات الإدارة',
  InstalledApplicationList: 'التطبيقات',
  Restrictions: 'القيود',
  DeviceLock: 'قفل الجهاز',
  ClearPasscode: 'مسح رمز القفل',
  RestartDevice: 'إعادة تشغيل',
  ShutDownDevice: 'إيقاف الجهاز',
  EraseDevice: 'مسح الجهاز',
};

const PY_AGENT = String.raw`import concurrent.futures, getpass, ipaddress, json, os, platform, socket, ssl, time
import urllib.error
import urllib.request

BASE_URL = '__BASE_URL__'
WORKSPACE_KEY = '__WORKSPACE_KEY__'
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cyberlab-agent.json')
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cyberlab_agent.log')
COMMON_PORTS = [21,22,23,25,53,80,110,135,139,143,389,443,445,465,587,636,993,995,1433,1521,2049,2375,3000,3306,3389,5000,5432,5900,6379,8000,8080,8443,9000,9200,27017]
WEB_PORTS = [80,443,3000,5000,8000,8080,8443,9000]
HEADERS = ['Content-Security-Policy','Strict-Transport-Security','X-Content-Type-Options','Referrer-Policy','Permissions-Policy','Cross-Origin-Opener-Policy']

def log(message):
    line = f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] {message}'
    print(line, flush=True)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def private_ip(value):
    ip = ipaddress.ip_address(value)
    return ip.is_private or ip.is_loopback or ip.is_link_local

def private_net(value):
    net = ipaddress.ip_network(value, strict=False)
    return (net.is_private or net.is_loopback or net.is_link_local) and net.num_addresses <= 256

def load_state():
    try:
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_state(state):
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f)

def request_json(method, url, payload=None, timeout=20):
    data = None
    headers = {'User-Agent': 'CyberLab-Agent/2.0'}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode('utf-8', errors='replace')
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'HTTP {e.code}: {body[:300]}') from e

def post(path, body):
    return request_json('POST', BASE_URL + path, {**body, 'workspaceKey': WORKSPACE_KEY}, 20)

def http_get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'CyberLab-Agent/2.0'})
    ctx = ssl.create_default_context()
    if url.lower().startswith('https://'):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=4, context=ctx) as r:
        headers = {k.lower(): v for k, v in r.headers.items()}
        return r.status, headers

def tcp_probe(ip, port, timeout=0.35):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    started = time.time()
    try:
        code = s.connect_ex((ip, port))
        return {'port': port, 'open': code == 0, 'latencyMs': round((time.time()-started)*1000,1)}
    finally:
        s.close()

def banner(ip, port):
    try:
        with socket.create_connection((ip, port), timeout=0.7) as s:
            s.settimeout(0.7)
            if port in [80,3000,5000,8000,8080,9000]:
                s.sendall(b'HEAD / HTTP/1.0\r\nHost: localhost\r\n\r\n')
            return s.recv(240).decode('utf-8', errors='replace').strip()
    except Exception:
        return ''

def port_scan(target):
    if not private_ip(target):
        raise ValueError('Public targets are blocked.')
    opened = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=48) as pool:
        futures = {pool.submit(tcp_probe, target, p): p for p in COMMON_PORTS}
        for f in concurrent.futures.as_completed(futures):
            r = f.result()
            if r['open']:
                r['banner'] = banner(target, r['port'])
                opened.append(r)
    opened.sort(key=lambda x: x['port'])
    findings = []
    high = {23:'Telnet',2375:'Docker API',6379:'Redis',9200:'Elasticsearch',27017:'MongoDB'}
    medium = {21:'FTP',445:'SMB',3389:'RDP',5900:'VNC',3306:'MySQL',5432:'PostgreSQL',1433:'MSSQL'}
    for p in opened:
        if p['port'] in high:
            findings.append({'severity':'high','title':f"{high[p['port']]} exposed on TCP/{p['port']}",'detail':'Confirm the service is required and restricted to trusted hosts.'})
        elif p['port'] in medium:
            findings.append({'severity':'medium','title':f"{medium[p['port']]} reachable on TCP/{p['port']}",'detail':'Review firewall scope, authentication and patch level.'})
    return {'openPorts': opened, 'findings': findings, 'score': max(0, 100 - sum(18 if f['severity']=='high' else 8 for f in findings))}

def lan_discover(cidr):
    if not private_net(cidr):
        raise ValueError('Only private networks up to /24 are allowed.')
    net = ipaddress.ip_network(cidr, strict=False)
    signal_ports = [80,443,22,445,3389]
    def probe(ip):
        ip = str(ip)
        for p in signal_ports:
            if tcp_probe(ip, p, 0.15)['open']:
                try: name = socket.gethostbyaddr(ip)[0]
                except Exception: name = ''
                return {'ip': ip, 'hostname': name, 'signalPort': p}
        return None
    hosts = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
        for item in pool.map(probe, net.hosts()):
            if item: hosts.append(item)
    return {'hosts': hosts, 'count': len(hosts), 'findings': [], 'score': 100}

def http_audit(target):
    if not private_ip(target):
        raise ValueError('Public targets are blocked.')
    endpoints, findings = [], []
    for port in WEB_PORTS:
        if not tcp_probe(target, port, 0.25)['open']:
            continue
        scheme = 'https' if port in [443,8443] else 'http'
        url = f'{scheme}://{target}:{port}/'
        try:
            status, headers = http_get(url)
            missing = [h for h in HEADERS if h.lower() not in headers]
            endpoints.append({'url':url,'status':status,'server':headers.get('server',''),'missingHeaders':missing})
            for h in missing:
                sev = 'medium' if h in ['Content-Security-Policy','Strict-Transport-Security'] else 'low'
                findings.append({'severity':sev,'title':f'Missing {h}','detail':f'{url} does not return this defensive browser header.'})
        except Exception as e:
            endpoints.append({'url':url,'error':str(e)})
    penalty = sum(8 if f['severity']=='medium' else 3 for f in findings)
    return {'endpoints':endpoints,'findings':findings,'score':max(0,100-penalty)}

def tls_audit(target):
    if not private_ip(target):
        raise ValueError('Public targets are blocked.')
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection((target,443),timeout=4) as raw:
        with ctx.wrap_socket(raw,server_hostname=target) as s:
            cert = s.getpeercert()
            cipher = s.cipher()
            version = s.version()
            findings = []
            if version in ['TLSv1','TLSv1.1']:
                findings.append({'severity':'high','title':f'Legacy {version} accepted','detail':'Disable legacy TLS protocols.'})
            return {'tlsVersion':version,'cipher':cipher[0] if cipher else '','bits':cipher[2] if cipher else 0,'notBefore':cert.get('notBefore'),'notAfter':cert.get('notAfter'),'findings':findings,'score':82 if findings else 100}

def system_info(_target):
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            value = info[4][0]
            if value not in ips: ips.append(value)
    except Exception:
        pass
    return {'hostname':socket.gethostname(),'platform':platform.platform(),'python':platform.python_version(),'user':getpass.getuser(),'addresses':ips,'findings':[],'score':100}

الأدوات = {'port_scan':port_scan,'lan_discover':lan_discover,'http_audit':http_audit,'tls_audit':tls_audit,'system_info':system_info}

def main():
    if not BASE_URL.startswith('https://'):
        raise RuntimeError('Invalid server URL.')
    state = load_state()
    agent_id = state.get('agentId')
    if not agent_id:
        data = post('/api/agent/register', {'name':socket.gethostname(),'platform':platform.platform()})
        agent_id = data['agentId']
        save_state({'agentId':agent_id})
    log('Connected to Cyber Lab.')
    log('Device ID: ' + agent_id)
    while True:
        try:
            job = post('/api/agent/poll', {'agentId':agent_id}).get('job')
            if job:
                log('Running: ' + job['module'] + ' ' + job.get('target',''))
                try:
                    fn = الأدوات[job['module']]
                    result = fn(job.get('target',''))
                    payload = {'agentId':agent_id,'jobId':job['id'],'ok':True,'result':result}
                except Exception as e:
                    payload = {'agentId':agent_id,'jobId':job['id'],'ok':False,'result':{'error':str(e),'findings':[],'score':0}}
                post('/api/agent/result', payload)
                log('Job finished.')
        except KeyboardInterrupt:
            log('Stopped by user.')
            return
        except Exception as e:
            log('Connection error: ' + str(e))
        time.sleep(2)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log('FATAL: ' + repr(e))
        if os.name == 'nt':
            try:
                input('Press Enter to close...')
            except Exception:
                pass
        raise
`;

function makeWorkspaceKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function isPrivateIPv4(value: string) {
  const p = value.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 169 && p[1] === 254)
  );
}

function validCidr(value: string) {
  const [ip, prefix] = value.split('/');
  const n = Number(prefix);
  return isPrivateIPv4(ip) && Number.isInteger(n) && n >= 24 && n <= 32;
}

function relativeTime(ts: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (seconds < 10) return 'متصل الآن';
  if (seconds < 60) return 'قبل ' + seconds + ' ث';
  if (seconds < 3600) return 'قبل ' + Math.floor(seconds / 60) + ' د';
  return 'قبل ' + Math.floor(seconds / 3600) + ' س';
}

function severityClass(s: string) {
  return s === 'high'
    ? 'sev high'
    : s === 'medium'
      ? 'sev med'
      : s === 'low'
        ? 'sev low'
        : 'sev info';
}

export default function App() {
  const [workspaceKey, setWorkspaceKey] = useState('');
  const [agents, setالأجهزة] = useState<Agent[]>([]);
  const [results, setالنتائج] = useState<ScanResult[]>([]);
  const [mobileDevices, setMobileDevices] = useState<MobileDevice[]>([]);
  const [mdmDevices, setMdmDevices] = useState<MdmDevice[]>([]);
  const [mdmCommands, setMdmCommands] = useState<MdmCommand[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [moduleId, setModuleId] = useState('port_scan');
  const [target, setTarget] = useState('192.168.1.1');
  const [agentId, setAgentId] = useState('');
  const [message, setMessage] = useState('جاهز. الفحص على شبكتك الخاصة فقط.');
  const [errorText, setErrorText] = useState('');
  const [pairOpen, setPairOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let key = localStorage.getItem('cyberlab.workspace');
    if (!key) {
      key = makeWorkspaceKey();
      localStorage.setItem('cyberlab.workspace', key);
    }
    setWorkspaceKey(key);
  }, []);

  useEffect(() => {
    if (!workspaceKey) return;
    const refresh = async () => {
      try {
        const [a, r, m, d, c, g] = await Promise.all([
          api.post('/api/agents/list', { workspaceKey }),
          api.post('/api/results/list', { workspaceKey }),
          api.post('/api/mobile/list', { workspaceKey }),
          api.post('/api/mdm/devices/list', { workspaceKey }),
          api.post('/api/mdm/commands/list', { workspaceKey }),
          api.post('/api/mdm/gateway/status', { workspaceKey }),
        ]);
        setالأجهزة(a.data.agents || []);
        setالنتائج(r.data.results || []);
        setMobileDevices(m.data.devices || []);
        setMdmDevices(d.data.devices || []);
        setMdmCommands(c.data.commands || []);
        setGateways(g.data.gateways || []);
        if (!agentId && a.data.agents?.[0]?.id) setAgentId(a.data.agents[0].id);
      } catch {
        setErrorText('تعذر تحديث البيانات.');
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 3500);
    return () => window.clearInterval(timer);
  }, [workspaceKey, agentId]);

  const onlineالأجهزة = useMemo(
    () => agents.filter(a => Date.now() / 1000 - a.lastSeen < 15),
    [agents]
  );
  const mobileOnline = useMemo(
    () => mobileDevices.filter(d => Date.now() / 1000 - d.lastSeen < 45),
    [mobileDevices]
  );
  const mdmOnline = useMemo(
    () => mdmDevices.filter(d => Date.now() / 1000 - d.lastSeen < 300),
    [mdmDevices]
  );
  const gatewayOnline = gateways.some(g => Date.now() / 1000 - g.lastSeen < 30);
  const latest = results[0];
  const findings = (latest?.result?.findings as Finding[] | undefined) || [];
  const highCount = findings.filter(f => f.severity === 'high').length;
  const medCount = findings.filter(f => f.severity === 'medium').length;
  const latestScore = Number(latest?.result?.score ?? 100);

  const queueJob = async () => {
    setErrorText('');
    const isSystem = moduleId === 'system_info';
    const scopeOk =
      isSystem ||
      (moduleId === 'lan_discover' ? validCidr(target) : isPrivateIPv4(target));
    if (!scopeOk) {
      setErrorText(
        moduleId === 'lan_discover'
          ? 'الشبكة الخاصة only, maximum scope /24.'
          : 'Public targets are blocked. Enter a private IPv4 address.'
      );
      return;
    }
    if (!agentId) {
      setErrorText('اربط جهازك أول.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/jobs/create', {
        workspaceKey,
        agentId,
        module: moduleId,
        target: isSystem ? 'local-agent' : target,
      });
      setMessage('تم إرسال الفحص للجهاز.');
      setTab('results');
    } catch (e) {
      setErrorText(
        e instanceof Error ? e.message : 'تعذر تشغيل الفحص.'
      );
    } finally {
      setBusy(false);
    }
  };

  const buildAgentScript = () =>
    PY_AGENT.replace('__BASE_URL__', window.location.origin).replace(
      '__WORKSPACE_KEY__',
      workspaceKey
    );

  const saveDownload = (content: string, name: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAgent = () => {
    saveDownload(buildAgentScript(), 'cyberlab_agent.py', 'text/x-python');
    setMessage('تم تحميل Agent. شغله ببايثون 3. ما يحتاج pip.');
  };

  const downloadWindowsAgent = () => {
    const script = buildAgentScript();
    const bytes = new TextEncoder().encode(script);
    let binary = '';
    bytes.forEach(byte => {
      binary += String.fromCharCode(byte);
    });
    const encoded = btoa(binary);
    const chunks = encoded.match(/.{1,1800}/g) || [];
    const lines = [
      '@echo off',
      'chcp 65001 >nul',
      'title Cyber Lab Agent',
      'setlocal',
      'echo [Cyber Lab] Starting agent...',
      'where py >nul 2>&1 && set "PY=py -3"',
      'if not defined PY where python >nul 2>&1 && set "PY=python"',
      'if not defined PY (',
      '  echo Python 3 is not installed.',
      '  start "" "https://www.python.org/downloads/windows/"',
      '  pause',
      '  exit /b 1',
      ')',
      'set "B64FILE=%TEMP%\\cyberlab_agent.b64"',
      'set "AGENTFILE=%TEMP%\\cyberlab_agent.py"',
      '>"%B64FILE%" type nul',
      ...chunks.map(chunk => '>>"%B64FILE%" echo ' + chunk),
      'powershell -NoProfile -Command "$b=[IO.File]::ReadAllText($env:B64FILE);[IO.File]::WriteAllBytes($env:AGENTFILE,[Convert]::FromBase64String($b))"',
      'if errorlevel 1 (echo Failed to prepare agent.& pause& exit /b 1)',
      '%PY% "%AGENTFILE%"',
      'echo.',
      'echo Agent stopped. Log: %TEMP%\\cyberlab_agent.log',
      'pause',
    ];
    saveDownload(
      lines.join('\r\n'),
      'cyberlab_agent_windows.bat',
      'application/x-bat'
    );
    setMessage('تم تحميل نسخة ويندوز. افتحها دبل كلك.');
  };

  const resetWorkspace = async () => {
    if (
      !confirm(
        'Reset this browser workspace? Existing agents/results will no longer be linked here.'
      )
    )
      return;
    const key = makeWorkspaceKey();
    localStorage.setItem('cyberlab.workspace', key);
    setWorkspaceKey(key);
    setالأجهزة([]);
    setالنتائج([]);
    setAgentId('');
    setMessage('تم إنشاء مساحة جديدة.');
  };

  const copyKey = async () => {
    await navigator.clipboard.writeText(workspaceKey);
    setMessage('تم نسخ مفتاح المساحة.');
  };

  const clearالنتائج = async () => {
    await api.post('/api/results/clear', { workspaceKey });
    setالنتائج([]);
    setMessage('تم مسح النتائج.');
  };

  const copyCompanionPairLink = async () => {
    const url = 'cyberlab://pair?server=' + encodeURIComponent(window.location.origin) + '&workspace=' + encodeURIComponent(workspaceKey);
    await navigator.clipboard.writeText(url);
    setMessage('تم نسخ رابط ربط الآيفون.');
  };

  const openCompanionPairLink = () => {
    const url = 'cyberlab://pair?server=' + encodeURIComponent(window.location.origin) + '&workspace=' + encodeURIComponent(workspaceKey);
    window.location.href = url;
  };

  const sendMdmCommand = async (deviceId: string, command: string) => {
    const destructive = ['DeviceLock', 'ClearPasscode', 'RestartDevice', 'ShutDownDevice', 'EraseDevice'].includes(command);
    let confirmToken = '';
    if (destructive) {
      const label = command === 'EraseDevice'
        ? 'ERASE this enrolled iPhone and remove its data'
        : 'send ' + command + ' to this enrolled device';
      if (!window.confirm('Confirm: ' + label + '?')) return;
      confirmToken = command === 'EraseDevice' ? 'ERASE' : 'CONFIRM';
    }
    setErrorText('');
    try {
      await api.post('/api/mdm/commands/create', {
        workspaceKey,
        deviceId,
        command,
        confirm: confirmToken,
      });
      setMessage(command + ' queued for the MDM gateway.');
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Could not queue MDM command.');
    }
  };

  const pageTitle =
    tab === 'overview'
      ? 'لوحة الحماية'
      : tab === 'assess'
        ? 'تشغيل فحص'
        : tab === 'agents'
          ? 'الأجهزة'
          : tab === 'apple'
            ? 'جوالات آبل'
            : 'النتائج';

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Shield size={22} />
          </div>
          <div>
            <strong>CYBER LAB</strong>
            <span>حماية شبكتك الخاصة</span>
          </div>
        </div>
        <nav>
          <button
            className={tab === 'overview' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('overview')}
          >
            <Activity size={17} /> الرئيسية
          </button>
          <button
            className={tab === 'assess' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('assess')}
          >
            <Radar size={17} /> فحص
          </button>
          <button
            className={tab === 'agents' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('agents')}
          >
            <Server size={17} /> الأجهزة <em>{onlineالأجهزة.length}</em>
          </button>
          <button
            className={tab === 'results' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('results')}
          >
            <TerminalSquare size={17} /> النتائج <em>{results.length}</em>
          </button>
          <button
            className={tab === 'apple' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('apple')}
          >
            <Smartphone size={17} /> Apple <em>{mobileOnline.length + mdmOnline.length}</em>
          </button>
        </nav>
        <div className="scope-box">
          <div className="scope-title">
            <span className="pulse-dot" />
            نطاق خاص فقط
          </div>
          <p>
            RFC1918 / loopback / link-local. Public IPs are rejected at three
            layers.
          </p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">مركز الحماية</div>
            <h1>{pageTitle}</h1>
          </div>
          <div className="top-actions">
            <div className="engine">
              <span className="pulse-dot" /> جاهز
            </div>
            <button className="btn ghost" onClick={() => setPairOpen(true)}>
              <Wifi size={16} /> ربط جهاز
            </button>
          </div>
        </header>

        {(message || errorText) && (
          <div className={errorText ? 'notice error' : 'notice'}>
            {errorText || message}
          </div>
        )}

        {tab === 'overview' && (
          <>
            <section className="metrics">
              <div className="metric">
                <span>تقييم الأمان</span>
                <strong>{latest ? latestScore : '—'}</strong>
                <small>آخر فحص</small>
              </div>
              <div className="metric">
                <span>Online الأجهزة</span>
                <strong>{onlineالأجهزة.length}</strong>
                <small>{agents.length} جهاز مربوط</small>
              </div>
              <div className="metric">
                <span>خطر عالي</span>
                <strong className={highCount ? 'danger-text' : ''}>
                  {highCount}
                </strong>
                <small>آخر نتيجة</small>
              </div>
              <div className="metric">
                <span>خطر متوسط</span>
                <strong>{medCount}</strong>
                <small>آخر نتيجة</small>
              </div>
            </section>
            <section className="two-col">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="kicker">الحالة</span>
                    <h2>آخر فحص</h2>
                  </div>
                  <ShieldCheck size={20} />
                </div>
                {!latest ? (
                  <div className="empty">
                    <Shield size={34} />
                    <b>ما فيه فحص للحين</b>
                    <span>
                      اربط جهازك وشغّل أول فحص.
                    </span>
                    <button
                      className="btn primary"
                      onClick={() => setTab('assess')}
                    >
                      ابدأ فحص
                    </button>
                  </div>
                ) : (
                  <div className="result-summary">
                    <div
                      className="score-ring"
                      style={{ '--score': latestScore } as React.CSSProperties}
                    >
                      <span>{latestScore}</span>
                      <small>/100</small>
                    </div>
                    <div>
                      <b>{latest.module.replace('_', ' ').toUpperCase()}</b>
                      <p>{latest.target}</p>
                      <span>
                        {findings.length} finding(s) •{' '}
                        {new Date(latest.completedAt * 1000).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="kicker">الأولوية</span>
                    <h2>أهم النتائج</h2>
                  </div>
                  <AlertTriangle size={20} />
                </div>
                {findings.length === 0 ? (
                  <div className="empty compact">
                    <CheckCircle2 size={30} />
                    <b>No medium/high findings in آخر نتيجة</b>
                  </div>
                ) : (
                  <div className="finding-list">
                    {findings.slice(0, 5).map((f, i) => (
                      <div className="finding" key={i}>
                        <span className={severityClass(f.severity)}>
                          {f.severity}
                        </span>
                        <div>
                          <b>{f.title}</b>
                          <p>{f.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
            <section className="panel quick-panel">
              <div className="panel-head">
                <div>
                  <span className="kicker">الأدوات</span>
                  <h2>أدوات الفحص</h2>
                </div>
                <button className="btn ghost" onClick={() => setTab('assess')}>
                  فتح الأدوات
                </button>
              </div>
              <div className="module-grid">
                {الأدوات.map(m => (
                  <button
                    className="module-card"
                    key={m.id}
                    onClick={() => {
                      setModuleId(m.id);
                      setTab('assess');
                    }}
                  >
                    <m.icon size={20} />
                    <b>{m.name}</b>
                    <span>{m.desc}</span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {tab === 'assess' && (
          <section className="assess-layout">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <span className="kicker">1 • النوع</span>
                  <h2>اختر الفحص</h2>
                </div>
              </div>
              <div className="module-list">
                {الأدوات.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setModuleId(m.id)}
                    className={
                      moduleId === m.id ? 'module-row selected' : 'module-row'
                    }
                  >
                    <m.icon size={19} />
                    <div>
                      <b>{m.name}</b>
                      <span>{m.desc}</span>
                    </div>
                    {moduleId === m.id && <CheckCircle2 size={18} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel run-card">
              <div className="panel-head">
                <div>
                  <span className="kicker">2 • الهدف</span>
                  <h2>إعداد الفحص</h2>
                </div>
              </div>
              <label>الجهاز</label>
              <select
                value={agentId}
                onChange={e => setAgentId(e.target.value)}
              >
                <option value="">اختر جهاز مربوط</option>
                {agents.map(a => (
                  <option value={a.id} key={a.id}>
                    {a.name} • {relativeTime(a.lastSeen)}
                  </option>
                ))}
              </select>
              {moduleId !== 'system_info' && (
                <>
                  <label>
                    {moduleId === 'lan_discover'
                      ? 'الشبكة الخاصة'
                      : 'IP خاص'}
                  </label>
                  <input
                    value={target}
                    onChange={e => setTarget(e.target.value)}
                    placeholder={
                      moduleId === 'lan_discover'
                        ? '192.168.1.0/24'
                        : '192.168.1.10'
                    }
                    dir="ltr"
                  />
                </>
              )}
              <div className="guard">
                <ShieldCheck size={18} />
                <div>
                  <b>الحماية مفعلة</b>
                  <span>
                    Public addresses are blocked by the site backend and the
                    Python agent.
                  </span>
                </div>
              </div>
              <button
                className="btn primary large"
                onClick={queueJob}
                disabled={busy}
              >
                {busy ? (
                  <RefreshCw className="spin" size={18} />
                ) : (
                  <Radar size={18} />
                )}{' '}
                {busy ? 'جاري الإرسال…' : 'Queue فحصment'}
              </button>
            </div>
          </section>
        )}

        {tab === 'agents' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="kicker">الأجهزة</span>
                <h2>الأجهزة المرتبطة</h2>
              </div>
              <button className="btn primary" onClick={() => setPairOpen(true)}>
                <Download size={16} /> ربط جهاز
              </button>
            </div>
            {agents.length === 0 ? (
              <div className="empty">
                <Server size={34} />
                <b>ما فيه جهاز مربوط</b>
                <span>
                  حمّل الـAgent على جهازك وشغّله.
                </span>
              </div>
            ) : (
              <div className="agent-grid">
                {agents.map(a => (
                  <div className="agent-card" key={a.id}>
                    <div className="agent-icon">
                      <Laptop size={21} />
                    </div>
                    <div>
                      <b>{a.name}</b>
                      <span>{a.platform}</span>
                      <small>{relativeTime(a.lastSeen)}</small>
                    </div>
                    <span
                      className={
                        Date.now() / 1000 - a.lastSeen < 15
                          ? 'status online'
                          : 'status offline'
                      }
                    >
                      {Date.now() / 1000 - a.lastSeen < 15
                        ? 'ONLINE'
                        : 'OFFLINE'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="workspace-row">
              <div>
                <span>مفتاح المساحة</span>
                <code>
                  {workspaceKey
                    ? workspaceKey.slice(0, 18) + '••••••••'
                    : 'Loading…'}
                </code>
              </div>
              <button className="icon-btn" onClick={copyKey}>
                <Copy size={16} />
              </button>
              <button className="btn ghost danger" onClick={resetWorkspace}>
                <RefreshCw size={15} /> مساحة جديدة
              </button>
            </div>
          </section>
        )}

        {tab === 'results' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="kicker">السجل</span>
                <h2>فحصment results</h2>
              </div>
              {results.length > 0 && (
                <button className="btn ghost danger" onClick={clearالنتائج}>
                  <Trash2 size={15} /> مسح
                </button>
              )}
            </div>
            {results.length === 0 ? (
              <div className="empty">
                <TerminalSquare size={34} />
                <b>ما فيه نتائج للحين</b>
                <span>
                  Queued assessments appear here automatically when an agent
                  completes them.
                </span>
              </div>
            ) : (
              <div className="results-list">
                {results.map(r => {
                  const rf = (r.result.findings as Finding[] | undefined) || [];
                  const score = Number(r.result.score ?? 0);
                  return (
                    <details
                      className="result-card"
                      key={r.id}
                      open={r.id === results[0]?.id}
                    >
                      <summary>
                        <div className="result-module">
                          <div className="agent-icon">
                            <ShieldCheck size={18} />
                          </div>
                          <div>
                            <b>{r.module.replace('_', ' ').toUpperCase()}</b>
                            <span>
                              {r.target} •{' '}
                              {new Date(r.completedAt * 1000).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="result-meta">
                          <span>{rf.length} findings</span>
                          <strong>{score}/100</strong>
                        </div>
                      </summary>
                      <div className="result-body">
                        {rf.length > 0 && (
                          <div className="finding-list">
                            {rf.map((f, i) => (
                              <div className="finding" key={i}>
                                <span className={severityClass(f.severity)}>
                                  {f.severity}
                                </span>
                                <div>
                                  <b>{f.title}</b>
                                  <p>{f.detail}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <pre>{JSON.stringify(r.result, null, 2)}</pre>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        )}


        {tab === 'apple' && (
          <>
            <section className="metrics apple-metrics">
              <div className="metric">
                <span>آيفون متصل</span>
                <strong>{mobileOnline.length}</strong>
                <small>{mobileDevices.length} جهاز مربوط</small>
              </div>
              <div className="metric">
                <span>مسجل MDM</span>
                <strong>{mdmDevices.length}</strong>
                <small>{mdmDevices.filter(d => d.supervised).length} تحت الإشراف</small>
              </div>
              <div className="metric">
                <span>بوابة MDM</span>
                <strong className={gatewayOnline ? '' : 'danger-text'}>
                  {gatewayOnline ? 'شغال' : 'متوقف'}
                </strong>
                <small>NanoMDM bridge</small>
              </div>
              <div className="metric">
                <span>أوامر معلقة</span>
                <strong>{mdmCommands.filter(c => c.status === 'queued' || c.status === 'dispatched').length}</strong>
                <small>قائمة الإدارة</small>
              </div>
            </section>

            <section className="two-col">
              <div className="panel">
                <div className="panel-head">
                  <div><span className="kicker">تطبيق الآيفون</span><h2>ربط الآيفون</h2></div>
                  <Smartphone size={20} />
                </div>
                <div className="apple-hero">
                  <div className="apple-orb"><Smartphone size={31} /></div>
                  <div>
                    <b>Cyber Lab للجوال</b>
                    <p>يعرض البطارية والتخزين والشبكة وإصدار iOS وحالة الاتصال.</p>
                  </div>
                </div>
                <div className="pair-actions">
                  <button className="btn primary" onClick={openCompanionPairLink}><Wifi size={15}/> فتح رابط الربط</button>
                  <button className="btn ghost" onClick={copyCompanionPairLink}><Copy size={15}/> نسخ الرابط</button>
                </div>
                <div className="workspace-row apple-key-row">
                  <div><span>مفتاح ربط الآيفون</span><code>{workspaceKey ? workspaceKey.slice(0, 24) + '••••••••' : 'Loading…'}</code></div>
                  <button className="icon-btn" onClick={copyKey}><KeyRound size={16}/></button>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div><span className="kicker">إدارة آبل</span><h2>حالة MDM</h2></div>
                  <ShieldCheck size={20} />
                </div>
                <div className="mdm-stack">
                  <div className="stack-step ok"><span>01</span><div><b>لوحة Cyber Lab</b><p>تدير الأجهزة والأوامر والنتائج.</p></div></div>
                  <div className={gatewayOnline ? 'stack-step ok' : 'stack-step warn'}><span>02</span><div><b>بوابة NanoMDM</b><p>{gatewayOnline ? 'البوابة متصلة.' : 'شغّل بوابة NanoMDM للربط.'}</p></div></div>
                  <div className="stack-step"><span>03</span><div><b>SCEP + TLS + APNs</b><p>مطلوبة للتسجيل وإرسال أوامر آبل.</p></div></div>
                  <div className="stack-step"><span>04</span><div><b>التسجيل والإشراف</b><p>الإشراف يفتح أقوى أوامر الإدارة المدعومة.</p></div></div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div><span className="kicker">الآيفون</span><h2>حالة الأجهزة</h2></div>
                <span>{mobileDevices.length} جهاز</span>
              </div>
              {mobileDevices.length === 0 ? (
                <div className="empty compact"><Smartphone size={30}/><b>ما فيه آيفون مربوط للحين</b><span>ثبت تطبيق iOS ثم افتح رابط الربط من هنا.</span></div>
              ) : (
                <div className="apple-device-grid">
                  {mobileDevices.map(d => (
                    <div className="apple-device-card" key={d.id}>
                      <div className="agent-icon"><Smartphone size={20}/></div>
                      <div className="apple-device-main">
                        <b>{d.name || 'iPhone'}</b>
                        <span>{d.model} • {d.systemName} {d.systemVersion}</span>
                        <small>{d.network || 'شبكة غير معروفة'} • {relativeTime(d.lastSeen)}</small>
                      </div>
                      <div className="telemetry">
                        <span><b>{Math.round(Math.max(0, d.batteryLevel) * 100)}%</b> بطارية</span>
                        <span><b>{Math.round((d.freeBytes || 0) / 1073741824)} GB</b> متاح</span>
                        <span className={Date.now()/1000-d.lastSeen<45?'status online':'status offline'}>{Date.now()/1000-d.lastSeen<45?'متصل':'غير متصل'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <div><span className="kicker">أجهزة MDM</span><h2>الأجهزة المسجلة</h2></div>
                <Lock size={19} />
              </div>
              {mdmDevices.length === 0 ? (
                <div className="empty compact"><Shield size={30}/><b>ما فيه جهاز MDM مسجل</b><span>جهز NanoMDM وSCEP وAPNs ثم سجل الآيفون.</span></div>
              ) : (
                <div className="mdm-device-list">
                  {mdmDevices.map(d => (
                    <div className="mdm-device" key={d.id}>
                      <div className="mdm-device-info">
                        <div className="agent-icon"><Smartphone size={20}/></div>
                        <div>
                          <b>{d.deviceName || 'Managed iPhone'}</b>
                          <span>{d.model || 'Apple device'} • {d.osVersion || 'iOS'} • {d.supervised ? 'تحت الإشراف' : 'مسجل'}</span>
                          <small>{d.enrollmentId.slice(0, 18)}… • {relativeTime(d.lastSeen)}</small>
                        </div>
                      </div>
                      <div className="mdm-actions">
                        {['DeviceInformation','SecurityInfo','ProfileList','InstalledApplicationList','Restrictions','DeviceLock','ClearPasscode','RestartDevice','ShutDownDevice','EraseDevice'].map(command => (
                          <button
                            key={command}
                            className={command === 'EraseDevice' ? 'cmd danger-cmd' : command === 'DeviceLock' || command === 'ClearPasscode' ? 'cmd warn-cmd' : 'cmd'}
                            onClick={() => sendMdmCommand(d.id, command)}
                          >
                            {MDM_LABELS[command] || command}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head"><div><span className="kicker">سجل الأوامر</span><h2>أوامر MDM</h2></div></div>
              {mdmCommands.length === 0 ? <div className="empty compact"><TerminalSquare size={28}/><b>ما فيه أوامر للحين</b></div> :
                <div className="command-table">
                  {mdmCommands.slice(0, 30).map(c => (
                    <div className="command-row" key={c.id}>
                      <code>{c.command}</code>
                      <span>{c.enrollmentId.slice(0, 14)}…</span>
                      <span className={'command-state ' + c.status}>{c.status}</span>
                      <small>{new Date(c.updatedAt * 1000).toLocaleString()}</small>
                    </div>
                  ))}
                </div>}
            </section>
          </>
        )}

        {pairOpen && (
          <div
            className="modal-backdrop"
            onMouseDown={() => setPairOpen(false)}
          >
            <div className="modal" onMouseDown={e => e.stopPropagation()}>
              <div className="panel-head">
                <div>
                  <span className="kicker">ربط الجهاز</span>
                  <h2>اربط الكمبيوتر</h2>
                </div>
                <button className="icon-btn" onClick={() => setPairOpen(false)}>
                  ×
                </button>
              </div>
              <div className="steps">
                <div>
                  <span>01</span>
                  <p>
                    حمّل الـAgent على جهازك.
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <p>
                    ما يحتاج تثبيت مكتبات إضافية.
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <p>
                    ويندوز: حمّل ملف BAT وافتحه دبل كلك.
                  </p>
                </div>
              </div>
              <div className="pair-note">
                <ShieldCheck size={19} />
                <p>
                  الـAgent يشغّل أدوات الفحص الموجودة بالموقع فقط.
                </p>
              </div>
              <div className="pair-downloads">
                <button className="btn primary large" onClick={downloadWindowsAgent}>
                  <Download size={18} /> تحميل لويندوز - دبل كلك
                </button>
                <button className="btn ghost large" onClick={downloadAgent}>
                  <Download size={18} /> تحميل Python
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
