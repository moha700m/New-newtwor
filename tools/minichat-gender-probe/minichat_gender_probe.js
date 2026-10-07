'use strict';

/*
  Minichat Gender Probe — diagnostic only.
  Observes the requested gender and the gender returned by BeginDialog.
  It does NOT modify arguments, return values, account state, or server replies.
*/

if (!ObjC.available) {
  throw new Error('Objective-C runtime is not available');
}

const state = {
  requested: -1,
  lastOutbound: null,
  lastPairId: null,
};

function genderName(v) {
  switch (Number(v)) {
    case 0: return 'Any';
    case 1: return 'Male';
    case 2: return 'Female';
    default: return 'Unknown(' + v + ')';
  }
}

function log(s) {
  console.log('[GenderProbe] ' + s);
}

function safeObj(p) {
  try { return new ObjC.Object(p); } catch (_) { return null; }
}

function safeLong(obj, selector, fallback) {
  try {
    if (!obj || !obj.respondsToSelector_(ObjC.selector(selector))) return fallback;
    return Number(obj[selector]());
  } catch (_) {
    return fallback;
  }
}

function safeString(obj, selector, fallback) {
  try {
    if (!obj || !obj.respondsToSelector_(ObjC.selector(selector))) return fallback;
    const value = obj[selector]();
    return value ? value.toString() : fallback;
  } catch (_) {
    return fallback;
  }
}

function findClass(names) {
  for (const n of names) {
    if (ObjC.classes[n]) return ObjC.classes[n];
  }
  return null;
}

function installHook(cls, selector, callbacks) {
  if (!cls) return false;
  const method = cls[selector];
  if (!method) {
    log('Missing selector ' + selector + ' on ' + cls.$className);
    return false;
  }
  Interceptor.attach(method.implementation, callbacks);
  log('Hooked ' + cls.$className + ' ' + selector);
  return true;
}

const VideoChatInteractor = findClass(['VideoChatInteractor']);
const BeginDialog = findClass(['_TtC8Minichat11BeginDialog']);

if (!VideoChatInteractor) log('VideoChatInteractor class not found');
if (!BeginDialog) log('BeginDialog class not found');

installHook(VideoChatInteractor, '- updateServerSex:', {
  onEnter(args) {
    const model = safeObj(args[2]);
    const serverType = safeLong(model, 'serverType', -1);
    state.requested = serverType;
    log('Requested = ' + genderName(serverType) + ' (' + serverType + ')');
  }
});

installHook(VideoChatInteractor, '- sendTextToServer:', {
  onEnter(args) {
    const text = safeObj(args[2]);
    if (!text) return;
    const s = text.toString();
    if (s.startsWith('UED') || s.startsWith('NXT') || s.startsWith('BGD')) {
      state.lastOutbound = s;
      log('OUT ' + s);
    }
  }
});

installHook(BeginDialog, '- initWithJson:', {
  onEnter(args) {
    this.json = safeObj(args[2]);
  },
  onLeave(retval) {
    const obj = safeObj(retval);
    if (!obj) return;

    const matched = safeLong(obj, 'gender', -1);
    const pairId = safeLong(obj, 'pairId', -1);
    const country = safeString(obj, 'country', '');
    state.lastPairId = pairId;

    const requested = state.requested;
    const status = (requested >= 0 && matched >= 0)
      ? (requested === matched ? 'MATCH' : 'DIFFERENT')
      : 'OBSERVED';

    const line =
      status +
      ' | Requested: ' + genderName(requested) + ' (' + requested + ')' +
      ' | Matched: ' + genderName(matched) + ' (' + matched + ')' +
      ' | PairId: ' + pairId +
      (country ? ' | Country: ' + country : '');

    log(line);
    send({
      type: 'gender-match',
      status,
      requested,
      requestedName: genderName(requested),
      matched,
      matchedName: genderName(matched),
      pairId,
      country
    });
  }
});

installHook(VideoChatInteractor, '- messagingSRServiceWebSocketDidReceiveMessage:', {
  onEnter(args) {
    const message = safeObj(args[2]);
    if (!message) return;
    const s = message.toString();
    if (s.indexOf('BGD') !== -1 || s.indexOf('Gender') !== -1) {
      log('IN ' + s);
    }
  }
});

log('Ready. Bundle: com.minichat');
log('Expected protocol: UED{"Gender":2} then NXT{}; BeginDialog.gender is the observed match gender.');
