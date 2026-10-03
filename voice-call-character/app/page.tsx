'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

type CallState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
type Message = { role: 'user' | 'assistant'; content: string };
type Persona = { name: string; style: string; instructions: string; voiceURI: string };

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
};

const DEFAULT_PERSONA: Persona = {
  name: 'ليان',
  style: 'سعودية، هادية، عفوية وطبيعية، وترد كأنها في مكالمة حقيقية',
  instructions: 'لا تطوّلين. خذي وقت المتصل في الكلام ولا تستعجلين الرد.',
  voiceURI: '',
};

const STATE_LABEL: Record<CallState, string> = {
  idle: 'جاهزة للمكالمة',
  listening: 'أسمعك…',
  thinking: 'أفكر…',
  speaking: 'أتكلم…',
  error: 'صار خطأ',
};

export default function Home() {
  const [callActive, setCallActive] = useState(false);
  const [callState, setCallState] = useState<CallState>('idle');
  const [muted, setMuted] = useState(false);
  const [interim, setInterim] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [persona, setPersona] = useState<Persona>(DEFAULT_PERSONA);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [manualText, setManualText] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [seconds, setSeconds] = useState(0);

  const recognitionRef = useRef<RecognitionLike | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextRef = useRef('');
  const callActiveRef = useRef(false);
  const mutedRef = useRef(false);
  const stateRef = useRef<CallState>('idle');
  const messagesRef = useRef<Message[]>([]);
  const personaRef = useRef<Persona>(DEFAULT_PERSONA);

  const updateState = useCallback((next: CallState) => {
    stateRef.current = next;
    setCallState(next);
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('voice-character-persona');
      if (stored) {
        const parsed = { ...DEFAULT_PERSONA, ...JSON.parse(stored) } as Persona;
        personaRef.current = parsed;
        setPersona(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => {
    if (!callActive) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [callActive]);

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {}
  }, []);

  const beginListening = useCallback(() => {
    if (!callActiveRef.current || mutedRef.current || stateRef.current === 'speaking' || stateRef.current === 'thinking') return;
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechSupported(false);
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new Recognition() as RecognitionLike;
      recognition.lang = 'ar-SA';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        let partial = '';
        let finalText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = String(result[0]?.transcript || '').trim();
          if (result.isFinal) finalText += `${text} `;
          else partial += `${text} `;
        }
        setInterim(partial.trim());
        if (finalText.trim()) {
          pendingTextRef.current = `${pendingTextRef.current} ${finalText}`.trim();
          if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
          turnTimerRef.current = setTimeout(() => {
            const text = pendingTextRef.current.trim();
            pendingTextRef.current = '';
            setInterim('');
            if (text) window.dispatchEvent(new CustomEvent('voice-turn', { detail: text }));
          }, 1250);
        }
      };

      recognition.onerror = (event: any) => {
        if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
          setSpeechSupported(false);
          updateState('error');
        }
      };

      recognition.onend = () => {
        if (callActiveRef.current && !mutedRef.current && stateRef.current === 'listening') {
          restartTimerRef.current = setTimeout(() => {
            try {
              recognitionRef.current?.start();
            } catch {}
          }, 260);
        }
      };

      recognitionRef.current = recognition;
    }

    updateState('listening');
    try {
      recognitionRef.current.start();
    } catch {}
  }, [updateState]);

  const speak = useCallback(
    (text: string) => {
      if (!('speechSynthesis' in window)) {
        updateState('listening');
        beginListening();
        return;
      }
      stopRecognition();
      window.speechSynthesis.cancel();
      updateState('speaking');

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ar-SA';
      utterance.rate = 0.96;
      utterance.pitch = 1.02;
      const selected = voices.find((voice) => voice.voiceURI === personaRef.current.voiceURI);
      const arabic = voices.find((voice) => voice.lang.toLowerCase().startsWith('ar'));
      if (selected || arabic) utterance.voice = selected || arabic || null;

      const finish = () => {
        if (!callActiveRef.current) return;
        updateState('listening');
        setTimeout(beginListening, 180);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    },
    [beginListening, stopRecognition, updateState, voices],
  );

  const submitTurn = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || stateRef.current === 'thinking') return;
      stopRecognition();
      updateState('thinking');
      const nextMessages: Message[] = [...messagesRef.current, { role: 'user', content: clean }].slice(-18);
      messagesRef.current = nextMessages;
      setMessages(nextMessages);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: nextMessages, persona: personaRef.current }),
        });
        const data = (await response.json()) as { text?: string; error?: string };
        if (!response.ok || !data.text) throw new Error(data.error || 'response failed');
        const withReply: Message[] = [...nextMessages, { role: 'assistant', content: data.text }].slice(-18);
        messagesRef.current = withReply;
        setMessages(withReply);
        speak(data.text);
      } catch (error) {
        console.error(error);
        updateState('error');
        setTimeout(() => {
          if (callActiveRef.current) {
            updateState('listening');
            beginListening();
          }
        }, 1200);
      }
    },
    [beginListening, speak, stopRecognition, updateState],
  );

  useEffect(() => {
    const listener = (event: Event) => submitTurn((event as CustomEvent<string>).detail);
    window.addEventListener('voice-turn', listener);
    return () => window.removeEventListener('voice-turn', listener);
  }, [submitTurn]);

  async function startCall() {
    setSeconds(0);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      setSpeechSupported(false);
    }
    callActiveRef.current = true;
    setCallActive(true);
    mutedRef.current = false;
    setMuted(false);
    updateState('listening');
    setTimeout(beginListening, 180);
  }

  function endCall() {
    callActiveRef.current = false;
    setCallActive(false);
    setInterim('');
    pendingTextRef.current = '';
    if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    try {
      recognitionRef.current?.abort();
    } catch {}
    window.speechSynthesis?.cancel();
    updateState('idle');
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) stopRecognition();
    else if (callActiveRef.current) {
      updateState('listening');
      setTimeout(beginListening, 120);
    }
  }

  function savePersona(next: Persona) {
    personaRef.current = next;
    setPersona(next);
    localStorage.setItem('voice-character-persona', JSON.stringify(next));
  }

  function sendManual(event: FormEvent) {
    event.preventDefault();
    if (!manualText.trim()) return;
    const text = manualText;
    setManualText('');
    submitTurn(text);
  }

  const duration = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const lastMessages = messages.slice(-5);

  return (
    <main className="shell">
      <section className={`call-card ${callActive ? 'active' : ''}`}>
        <header className="topbar">
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="إعدادات الشخصية">⋯</button>
          <div className="security-pill"><span className="dot" /> مكالمة خاصة</div>
          <div className="spacer" />
        </header>

        <div className="hero">
          <div className={`avatar ${callState}`} aria-hidden="true">
            <div className="avatar-core">{persona.name.trim().charAt(0) || 'ل'}</div>
            <div className="ring ring-one" />
            <div className="ring ring-two" />
          </div>
          <h1>{persona.name || 'ليان'}</h1>
          <p className={`state state-${callState}`}>{callActive ? STATE_LABEL[callState] : 'شخصيتك الصوتية'}</p>
          {callActive && <div className="timer">{duration}</div>}
        </div>

        <div className="transcript" aria-live="polite">
          {lastMessages.length === 0 && !interim ? (
            <p className="empty-copy">{callActive ? 'تكلم براحتك… ما راح ترد إلا بعد ما تخلص.' : 'اضغط اتصال وابدأ الكلام بشكل طبيعي.'}</p>
          ) : (
            <>
              {lastMessages.map((message, index) => (
                <div className={`bubble ${message.role}`} key={`${index}-${message.content.slice(0, 10)}`}>
                  <span>{message.role === 'user' ? 'أنت' : persona.name}</span>
                  <p>{message.content}</p>
                </div>
              ))}
              {interim && <div className="live-caption">{interim}</div>}
            </>
          )}
        </div>

        {!speechSupported && callActive && (
          <form className="manual-input" onSubmit={sendManual}>
            <input value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="الميكروفون غير متاح — اكتب هنا" />
            <button type="submit">إرسال</button>
          </form>
        )}

        <div className="controls">
          {callActive ? (
            <>
              <button className={`control mute ${muted ? 'selected' : ''}`} onClick={toggleMute}>
                <span>{muted ? '⌁' : '◉'}</span><small>{muted ? 'تشغيل المايك' : 'كتم'}</small>
              </button>
              <button className="hangup" onClick={endCall} aria-label="إنهاء المكالمة"><span>×</span></button>
              <button className="control" onClick={() => setSettingsOpen(true)}>
                <span>⚙</span><small>الشخصية</small>
              </button>
            </>
          ) : (
            <button className="call-button" onClick={startCall}><span>●</span> اتصال الآن</button>
          )}
        </div>

        <footer>انتظار ذكي قبل الرد · عربي سعودي · GPT‑5.6 Luna</footer>
      </section>

      {settingsOpen && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <section className="settings-panel">
            <div className="panel-head"><div><small>تخصيص</small><h2>الشخصية</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></div>
            <label>الاسم<input value={persona.name} onChange={(event) => savePersona({ ...persona, name: event.target.value })} maxLength={40} /></label>
            <label>أسلوب الكلام<textarea value={persona.style} onChange={(event) => savePersona({ ...persona, style: event.target.value })} rows={3} /></label>
            <label>تعليمات إضافية<textarea value={persona.instructions} onChange={(event) => savePersona({ ...persona, instructions: event.target.value })} rows={4} /></label>
            <label>صوت الجهاز
              <select value={persona.voiceURI} onChange={(event) => savePersona({ ...persona, voiceURI: event.target.value })}>
                <option value="">تلقائي — أفضل صوت عربي متاح</option>
                {voices.map((voice) => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}
              </select>
            </label>
            <div className="provider-note"><strong>Vibi / ElevenLabs</strong><p>البنية جاهزة لإضافة مزود صوت خارجي. الربط يحتاج API رسمي من المزود؛ كود Redeem وحده ليس مفتاح API.</p></div>
            <button className="done" onClick={() => setSettingsOpen(false)}>تم</button>
          </section>
        </div>
      )}
    </main>
  );
}
