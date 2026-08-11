// ---------- DOM ----------
const clockTime = document.getElementById('clockTime');
const clockDate = document.getElementById('clockDate');
const clockNextAlarm = document.getElementById('clockNextAlarm');

const timeText = document.getElementById('timeText');
const progressBar = document.getElementById('progressBar');
const progressWrap = document.getElementById('progressWrap');
const timerStatus = document.getElementById('timerStatus');
const activityInput = document.getElementById('activityInput');
const activityLabel = document.getElementById('activityLabel');
const startBtn = document.getElementById('startBtn');
const focusStartBtn = document.getElementById('focusStartBtn');
const focusPlusOne = document.getElementById('focusPlusOne');
const focusExitBtn = document.getElementById('focusExitBtn');
const resetBtn = document.getElementById('resetBtn');
const modeBtn = document.getElementById('modeBtn');
const minusOne = document.getElementById('minusOne');
const plusOne = document.getElementById('plusOne');
const plusFive = document.getElementById('plusFive');

const settingsBtn = document.getElementById('settingsBtn');
const alarmBtn = document.getElementById('alarmBtn');
const minimizeBtn = document.getElementById('minimizeBtn');
const maximizeBtn = document.getElementById('maximizeBtn');
const closeBtn = document.getElementById('closeBtn');
const titlebar = document.querySelector('.titlebar');

const navClock = document.getElementById('navClock');
const navTimer = document.getElementById('navTimer');
const clockView = document.getElementById('clockView');
const timerView = document.getElementById('timerView');

const fullscreenBtn = document.getElementById('fullscreenBtn');

const overlay = document.getElementById('overlay');
const overlayTime = document.getElementById('overlayTime');
const overlayMsg = document.getElementById('overlayMsg');
const dismissBtn = document.getElementById('dismissBtn');
const snoozeBtn = document.getElementById('snoozeBtn');

// ---------- 상태 ----------
// 설정/알람 목록 편집은 별도의 설정 창(settings.html)에서 이루어지고,
// 이 창(메인 위젯)은 settings:changed 브로드캐스트를 받아 화면 표시만 동기화한다.
let mode = 'countdown';
let totalSeconds = 300;
let remainingSeconds = 300;
let elapsedSeconds = 0;
let running = false;
let hasStarted = false;
let resetArmHandle = null;
let resetArmed = false;
let activityName = '집중 시간';
let volume = 0.8;
let muted = false;
let speak = true;
let alarms = [];              // { id, time:"HH:MM", msg, repeat, enabled }
let firedKeys = {};           // 같은 분에 중복 발동 방지: { alarmId: "YYYY-M-D-HH:MM" }
let overlayActive = false;
let defaultMsg = '알람';
let timerMsg = '시간 종료!';
let autoDismissSec = 0;
let autoDismissHandle = null;
let onlineVoiceEnabled = true;
let onlineVoiceName = 'ko-KR-SunHiNeural';
let ttsAudioEl = null;
let clickThroughEnabled = false;
let lastPassthroughIgnore = null;
let showNextAlarm = true;
let timerRepeatCount = 3;
let alarmFullscreenSetting = false;
let lastFiredRepeatCount = 3;
let uiTheme = 'sunny';
let alarmQueue = [];
let chimeSound = 'none';

const UI_THEMES = new Set(['classic', 'sunny', 'forest', 'space']);
function applyUiTheme(theme) {
  uiTheme = UI_THEMES.has(theme) ? theme : 'classic';
  document.body.dataset.uiTheme = uiTheme;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

// ---------- 유틸 ----------
function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatTimeAria(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h}시간` : '', m ? `${m}분` : '', s ? `${s}초` : ''].filter(Boolean).join(' ') || '0초';
}

// ---------- 시계 ----------
function updateClock(now) {
  clockTime.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  clockDate.textContent =
    `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()} (${WEEKDAY_KO[now.getDay()]}) ${pad(now.getSeconds())}초`;
  updateNextAlarmLabel();
}

function getNextAlarmDate(alarm, now) {
  const [hour, minute] = String(alarm.time || '').split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute, 0, 0);
    if (candidate <= now) continue;
    const day = candidate.getDay();
    if (alarm.repeat === 'weekdays' && (day === 0 || day === 6)) continue;
    if (alarm.repeat === 'custom' && !(Array.isArray(alarm.days) && alarm.days.includes(day))) continue;
    return candidate;
  }
  return null;
}

function updateNextAlarmLabel() {
  if (!showNextAlarm) { clockNextAlarm.textContent = ''; return; }
  const now = new Date();
  const upcoming = alarms.filter((a) => a.enabled).map((alarm) => ({ alarm, date: getNextAlarmDate(alarm, now) }))
    .filter((item) => item.date).sort((a, b) => a.date - b.date);
  if (upcoming.length === 0) { clockNextAlarm.textContent = ''; return; }
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`;
  clockNextAlarm.textContent = '다음 알람  ' +
    upcoming.slice(0, 3).map(({ alarm, date }) => {
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const dayLabel = key === todayKey ? '오늘' : key === tomorrowKey ? '내일' : `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_KO[date.getDay()]})`;
      return `${dayLabel} ${alarm.time}${alarm.msg ? ` ${alarm.msg}` : ''}`;
    }).join('  ·  ');
}

// ---------- 타이머 ----------
function updateTimerDisplay() {
  let visualState = 'normal';
  if (mode === 'countdown') {
    timeText.textContent = formatTime(remainingSeconds);
    const ratio = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
    progressBar.style.width = `${Math.max(0, ratio * 100)}%`;
    progressWrap.setAttribute('aria-valuemax', String(totalSeconds));
    progressWrap.setAttribute('aria-valuenow', String(remainingSeconds));
    progressWrap.setAttribute('aria-valuetext', `${formatTimeAria(remainingSeconds)} 남음`);
    timeText.setAttribute('aria-label', `남은 시간 ${formatTimeAria(remainingSeconds)}`);
    timeText.classList.remove('warn', 'danger');
    progressBar.classList.remove('warn', 'danger');
    // 긴 활동은 1분 전부터 마무리를 안내하고, 모든 활동은 마지막 10초를 또렷하게 강조한다.
    if (remainingSeconds <= 10 && hasStarted) visualState = 'danger';
    else if (remainingSeconds <= 60 && totalSeconds > 60 && hasStarted) visualState = 'warn';
    if (visualState !== 'normal') {
      timeText.classList.add(visualState);
      progressBar.classList.add(visualState);
    }
  } else {
    timeText.textContent = formatTime(elapsedSeconds);
    progressBar.style.width = '100%';
    progressWrap.setAttribute('aria-valuemax', '100');
    progressWrap.setAttribute('aria-valuenow', running ? '100' : '0');
    progressWrap.setAttribute('aria-valuetext', `${formatTimeAria(elapsedSeconds)} 경과`);
    timeText.setAttribute('aria-label', `경과 시간 ${formatTimeAria(elapsedSeconds)}`);
    timeText.classList.remove('warn', 'danger');
    progressBar.classList.remove('warn', 'danger');
  }
  updateTimerStatus(visualState);
}

function updateTimerStatus(visualState = 'normal') {
  timerStatus.classList.remove('warn', 'danger');
  if (resetArmed) {
    timerStatus.textContent = '초기화하려면 한 번 더 눌러요';
    timerStatus.classList.add('danger');
    return;
  }
  if (!hasStarted) timerStatus.textContent = '준비되면 시작해요';
  else if (!running) timerStatus.textContent = '잠시 멈췄어요';
  else if (visualState === 'danger') {
    timerStatus.textContent = '10초 남았어요';
    timerStatus.classList.add('danger');
  } else if (visualState === 'warn') {
    timerStatus.textContent = '이제 마무리해요';
    timerStatus.classList.add('warn');
  } else timerStatus.textContent = mode === 'countdown' ? '집중해서 해봐요' : '시간을 재고 있어요';
}

function syncTimerControls() {
  document.body.dataset.timerRunning = String(hasStarted);
  startBtn.textContent = running ? '일시정지' : (hasStarted ? '계속하기' : '시작');
  focusStartBtn.textContent = running ? '일시정지' : '계속하기';
  focusStartBtn.setAttribute('aria-label', running ? '타이머 일시정지' : '타이머 계속하기');
}

function start() {
  if (running) return;
  if (mode === 'countdown' && remainingSeconds <= 0) remainingSeconds = totalSeconds;
  clearResetArm();
  hasStarted = true;
  running = true;
  syncTimerControls();
  updateTimerDisplay();
}
function stop(exitFocus = false) {
  running = false;
  if (exitFocus) hasStarted = false;
  syncTimerControls();
  updateTimerDisplay();
}
function toggleStart() { running ? stop(false) : start(); }

function clearResetArm() {
  resetArmed = false;
  resetBtn.classList.remove('reset-armed');
  resetBtn.textContent = '처음으로';
  if (resetArmHandle) clearTimeout(resetArmHandle);
  resetArmHandle = null;
}

function reset() {
  clearResetArm();
  running = false;
  hasStarted = false;
  if (mode === 'countdown') remainingSeconds = totalSeconds; else elapsedSeconds = 0;
  syncTimerControls();
  updateTimerDisplay();
}

function requestReset() {
  if (!resetArmed) {
    resetArmed = true;
    resetBtn.classList.add('reset-armed');
    resetBtn.textContent = '한 번 더 누르면 초기화';
    updateTimerStatus();
    resetArmHandle = setTimeout(() => {
      clearResetArm();
      updateTimerDisplay();
    }, 3000);
    return;
  }
  reset();
}

function setMode(newMode) {
  clearResetArm();
  running = false; hasStarted = false; mode = newMode;
  modeBtn.textContent = mode === 'countdown' ? '스톱워치로' : '카운트다운으로';
  if (mode === 'countdown') remainingSeconds = totalSeconds; else elapsedSeconds = 0;
  syncTimerControls();
  updateTimerDisplay();
}
function setPreset(sec) {
  clearResetArm();
  mode = 'countdown'; modeBtn.textContent = '스톱워치로';
  totalSeconds = sec; remainingSeconds = sec; running = false; hasStarted = false;
  syncTimerControls();
  updateTimerDisplay();
  window.timerAPI.setSettings({ lastPreset: sec });
}
function adjustTime(delta) {
  if (mode !== 'countdown') return;
  totalSeconds = Math.max(1, totalSeconds + delta);
  remainingSeconds = Math.max(0, remainingSeconds + delta);
  updateTimerDisplay();
}

function updateOverlayTime(now) {
  overlayTime.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// 1초 틱 (타이머 진행 + 알람 체크는 한 곳에서)
setInterval(() => {
  const now = new Date();
  updateClock(now);
  if (overlayActive) updateOverlayTime(now);   // 알람 발동 중엔 초 단위까지 갱신해 얼마 안 남았는지 보여줌

  if (running) {
    if (mode === 'countdown') {
      remainingSeconds -= 1;
      if (remainingSeconds <= 0) {
        remainingSeconds = 0;
        updateTimerDisplay();
        stop(true);
        fireAlarm(timerMsg, 'timer', timerRepeatCount);
      } else {
        updateTimerDisplay();
      }
    } else {
      elapsedSeconds += 1;
      updateTimerDisplay();
    }
  }

  checkAlarms(now);
}, 1000);

// ---------- 알람 발동 ----------
async function fireAlarm(message, source, repeatCount) {
  if (overlayActive) {
    alarmQueue.push({ message, source, repeatCount });
    return;
  }
  const fallback = source === 'timer' ? (timerMsg || '시간 종료!') : (defaultMsg || '알람');
  const text = (message && message.trim()) || fallback;
  const count = Math.max(1, parseInt(repeatCount, 10) || 3);
  lastFiredRepeatCount = count;
  overlayActive = true;
  updateOverlayTime(new Date());
  overlayMsg.textContent = text;
  overlay.classList.add('show');
  await window.timerAPI.grow();   // 창을 먼저 확대한 뒤에 전체화면 전환을 요청해야 순서가 꼬이지 않음
  if (alarmFullscreenSetting) {
    await window.timerAPI.setAlarmFullscreen(true);
    alarmFullscreenOn = true;
    fullscreenBtn.textContent = '창 크기로';
  } else {
    await window.timerAPI.setAlarmFullscreen(false);
    alarmFullscreenOn = false;
    fullscreenBtn.textContent = '전체화면';
  }
  startAlarm(text, count);

  if (autoDismissHandle) clearTimeout(autoDismissHandle);
  if (autoDismissSec > 0) {
    autoDismissHandle = setTimeout(dismissAlarm, autoDismissSec * 1000);
  }
}

function dismissAlarm() {
  overlayActive = false;
  if (autoDismissHandle) { clearTimeout(autoDismissHandle); autoDismissHandle = null; }
  overlay.classList.remove('show');
  stopAlarm();
  alarmFullscreenOn = false;
  fullscreenBtn.textContent = '전체화면';
  const next = alarmQueue.shift();
  if (next) {
    setTimeout(() => fireAlarm(next.message, next.source, next.repeatCount), 0);
    return;
  }
  window.timerAPI.restoreSize();
  lastPassthroughIgnore = null;   // 복원 시 클릭 통과 상태가 강제로 재적용되므로 다음 mousemove에서 다시 계산하게 함
}

function snoozeAlarm() {
  const msg = overlayMsg.textContent;
  dismissAlarm();
  // 5분 뒤 일회성 알람 등록
  const t = new Date(Date.now() + 5 * 60 * 1000);
  alarms.push({
    id: 'snooze-' + Date.now(),
    time: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
    msg: msg,
    repeat: 'once',
    repeatCount: lastFiredRepeatCount,
    enabled: true
  });
  persistAlarms();
}

dismissBtn.addEventListener('click', dismissAlarm);
snoozeBtn.addEventListener('click', snoozeAlarm);

function applyOverlayColor(color) { overlay.setAttribute('data-color', color); }
function applyOverlayScale(scale) { overlay.style.setProperty('--ov-scale', scale); }

const CLOCK_FG_PRESETS = {
  white: '#ffffff', green: '#3ecf8e', blue: '#4696ff',
  yellow: '#ffd93d', pink: '#ff78b4', red: '#ff5a5a', black: '#111111'
};
const CLOCK_BG_PRESETS = {
  none: 'transparent',
  green: 'rgba(62,207,142,0.35)',
  blue: 'rgba(70,150,255,0.35)',
  orange: 'rgba(255,160,60,0.35)',
  pink: 'rgba(255,120,180,0.35)',
  red: 'rgba(255,90,90,0.35)',
  dark: 'rgba(20,20,24,0.5)',
  white: 'rgba(255,255,255,0.25)'
};
function applyClockFg(key) { document.documentElement.style.setProperty('--clock-fg', CLOCK_FG_PRESETS[key] || '#ffffff'); }
function applyClockBg(key) { document.documentElement.style.setProperty('--clock-bg', CLOCK_BG_PRESETS[key] || 'transparent'); }

// ---------- 알람 소리 / 음성 ----------
let alarmLoop = null;

// 음성 목록은 비동기로 로드되므로 미리 캐시해 둔다
let cachedVoices = [];
function loadVoices() {
  try { cachedVoices = window.speechSynthesis.getVoices() || []; } catch (e) { cachedVoices = []; }
}
if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickKoreanVoice() {
  const vs = (cachedVoices && cachedVoices.length) ? cachedVoices : (window.speechSynthesis.getVoices() || []);
  // 한국어(ko-*) 음성 우선, 없으면 이름에 Korean 포함
  return vs.find((v) => v.lang && v.lang.toLowerCase().startsWith('ko'))
      || vs.find((v) => /korean|한국/i.test(v.name || ''))
      || null;
}

function speakOffline(msg) {
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(msg);
    u.lang = 'ko-KR';
    const v = pickKoreanVoice();
    if (v) u.voice = v;                       // 윈도우 기본 한국어 음성(Heami) - 오프라인 폴백
    u.volume = Math.min(1, volume + 0.2);
    u.rate = 1.0;
    u.pitch = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch (e) { /* speech unavailable */ }
}

// 인터넷 연결 시 Edge의 고품질 온라인 음성 사용. 실패/시간초과하면 false를 반환해 오프라인으로 폴백하게 한다.
function speakOnlineEdge(msg) {
  return new Promise(async (resolve) => {
    try {
      const b64 = await window.timerAPI.synthesizeEdge(msg, onlineVoiceName);
      if (!b64) { resolve(false); return; }
      if (ttsAudioEl) { try { ttsAudioEl.pause(); } catch (e) {} }
      ttsAudioEl = new Audio('data:audio/mpeg;base64,' + b64);
      ttsAudioEl.volume = Math.min(1, volume + 0.2);
      ttsAudioEl.onerror = () => resolve(false);
      await ttsAudioEl.play();
      resolve(true);
    } catch (e) {
      resolve(false);
    }
  });
}

async function speakMessage(msg) {
  if (muted || !msg) return;
  if (onlineVoiceEnabled) {
    const ok = await speakOnlineEdge(msg);
    if (ok) return;
  }
  speakOffline(msg);
}

// ---------- 알림음(차임): 음성 안내 전에 주의를 환기시키는 짧은 소리, 외부 파일 없이 생성 ----------
let chimeAudioCtx = null;
function getChimeCtx() {
  if (!chimeAudioCtx) chimeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (chimeAudioCtx.state === 'suspended') chimeAudioCtx.resume();
  return chimeAudioCtx;
}
function playTone(ctx, freq, startTime, duration, type, gainValue) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}
function playChime(type) {
  if (!type || type === 'none') return;
  try {
    const ctx = getChimeCtx();
    const now = ctx.currentTime;
    const gainValue = Math.min(1, typeof volume === 'number' ? volume : 0.8) * 0.5;
    if (type === 'chime') {
      playTone(ctx, 880, now, 0.5, 'sine', gainValue);
      playTone(ctx, 1318.5, now + 0.18, 0.6, 'sine', gainValue);
    } else if (type === 'bell') {
      [0, 0.35, 0.7].forEach((t) => playTone(ctx, 1046.5, now + t, 0.3, 'triangle', gainValue));
    } else if (type === 'xylophone') {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => playTone(ctx, freq, now + i * 0.13, 0.35, 'triangle', gainValue * 0.9));
    }
  } catch (e) { /* 오디오 장치 없음 등 */ }
}

// 알람 시작: 첫 안내 전에만 알림음(설정 시)을 울린 뒤 메시지 음성 안내, 지정된 횟수만큼만 반복(화면은 이후에도 계속 표시됨)
function startAlarm(text, repeatCount) {
  stopAlarm();
  window.timerAPI.flash();
  const max = Math.max(1, parseInt(repeatCount, 10) || 3);
  let count = 0;
  const cycle = () => {
    count++;
    const hasChime = count === 1 && chimeSound !== 'none' && !muted;
    if (hasChime) playChime(chimeSound);
    if (speak && !muted) setTimeout(() => speakMessage(text), hasChime ? 900 : 0);
    if (count >= max && alarmLoop) { clearInterval(alarmLoop); alarmLoop = null; }
  };
  cycle();
  if (count < max) alarmLoop = setInterval(cycle, 6000);
}

function stopAlarm() {
  if (alarmLoop) { clearInterval(alarmLoop); alarmLoop = null; }
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
  if (ttsAudioEl) { try { ttsAudioEl.pause(); ttsAudioEl.currentTime = 0; } catch (e) {} }
}

// ---------- 예약 알람 체크 ----------
function checkAlarms(now) {
  if (now.getSeconds() !== 0) return;   // 매 분 정각에만 체크
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${hhmm}`;
  const day = now.getDay(); // 0=일 ... 6=토
  const isWeekday = day >= 1 && day <= 5;

  alarms.forEach((a) => {
    if (!a.enabled || a.time !== hhmm) return;
    if (a.repeat === 'weekdays' && !isWeekday) return;
    if (a.repeat === 'custom' && !(Array.isArray(a.days) && a.days.includes(day))) return;
    if (firedKeys[a.id] === dateKey) return;    // 이미 이 분에 발동함
    firedKeys[a.id] = dateKey;

    fireAlarm(a.msg, 'alarm', a.repeatCount);   // 빈 메시지는 fireAlarm에서 알람 기본 문구로 대체

    if (a.repeat === 'once') {
      if (a.id.startsWith('snooze-')) {
        alarms = alarms.filter((x) => x.id !== a.id);  // 미루기 알람은 발동 후 제거
      } else {
        a.enabled = false;                              // 일회성은 꺼두기(기록 유지)
      }
      persistAlarms();
    }
  });
}

function persistAlarms() {
  // snooze/once 알람 상태 변경을 저장하고, 설정 창이 열려 있다면 settings:changed로 목록이 갱신된다.
  window.timerAPI.setSettings({ alarms });
}

// ---------- 뷰 전환 ----------
function showView(view) {
  const isClock = view === 'clock';
  clockView.classList.toggle('active', isClock);
  timerView.classList.toggle('active', !isClock);
  navClock.classList.toggle('active', isClock);
  navTimer.classList.toggle('active', !isClock);
  window.timerAPI.setSettings({ view });
}

// ---------- 이벤트 바인딩 ----------
document.querySelectorAll('.presets button').forEach((btn) => {
  btn.addEventListener('click', () => setPreset(parseInt(btn.dataset.sec, 10)));
});
startBtn.addEventListener('click', toggleStart);
focusStartBtn.addEventListener('click', toggleStart);
resetBtn.addEventListener('click', requestReset);
modeBtn.addEventListener('click', () => setMode(mode === 'countdown' ? 'stopwatch' : 'countdown'));
minusOne.addEventListener('click', () => adjustTime(-60));
plusOne.addEventListener('click', () => adjustTime(60));
plusFive.addEventListener('click', () => adjustTime(300));
focusPlusOne.addEventListener('click', () => adjustTime(60));
focusExitBtn.addEventListener('click', () => stop(true));
activityInput.addEventListener('input', () => {
  activityName = activityInput.value.trim() || '집중 시간';
  activityLabel.textContent = activityName;
});
activityInput.addEventListener('change', () => window.timerAPI.setSettings({ activityName }));

navClock.addEventListener('click', () => showView('clock'));
navTimer.addEventListener('click', () => showView('timer'));

// 설정/알람 버튼: 위젯 크기를 바꾸지 않는 별도 창을 연다(안 그러면 vh 단위인 시계 글씨가 같이 커짐).
settingsBtn.addEventListener('click', () => window.timerAPI.openSettingsWindow('settings'));
alarmBtn.addEventListener('click', () => window.timerAPI.openSettingsWindow('alarm'));

minimizeBtn.addEventListener('click', () => window.timerAPI.minimize());
closeBtn.addEventListener('click', () => window.timerAPI.close());

function updateMaximizeButton(isMaximized) {
  maximizeBtn.textContent = isMaximized ? '❐' : '□';
  maximizeBtn.title = isMaximized ? '원래 크기로' : '최대화';
  maximizeBtn.setAttribute('aria-label', maximizeBtn.title);
}

async function toggleWidgetMaximize() {
  const isMaximized = await window.timerAPI.toggleMaximize();
  updateMaximizeButton(!!isMaximized);
}

maximizeBtn.addEventListener('click', toggleWidgetMaximize);
window.timerAPI.onMaximizedChanged(updateMaximizeButton);

// 타이틀바/⠿ 핸들은 네이티브 드래그 영역(-webkit-app-region: drag)이 이동을 담당한다.
// 시계·타이머 화면 몸통(버튼 제외)은 네이티브 드래그 영역이 아니므로, 여기서 잡은
// pointerdown을 Pointer Capture로 추적해 같은 방식(IPC)으로 이동시킨다.
// Alt를 누르고 있으면 버튼/타이틀바 위에서 시작해도 항상 이동으로 취급한다(클릭 통과 모드에서 특히 유용).
let altDragPointerId = null;
let altDragCaptureElement = null;

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || altDragPointerId !== null) return;
  if (!e.altKey) {
    // 버튼/입력창은 원래 동작(클릭)을 하게 두고, 타이틀바는 네이티브 드래그 영역이 이미 처리한다.
    if (e.target.closest('button, input, select, textarea, .titlebar')) return;
  }
  altDragPointerId = e.pointerId;
  altDragCaptureElement = e.target instanceof Element ? e.target : document.documentElement;
  try { altDragCaptureElement.setPointerCapture(e.pointerId); } catch (_) { /* 캡처 미지원 환경 */ }
  window.timerAPI.startAltDrag(e.screenX, e.screenY);
  e.preventDefault();
  e.stopPropagation();
}, true);

document.addEventListener('pointermove', (e) => {
  if (e.pointerId !== altDragPointerId) return;
  window.timerAPI.updateAltDrag(e.screenX, e.screenY);
  e.preventDefault();
}, true);

function finishAltDrag(e) {
  if (altDragPointerId === null || (e.pointerId !== undefined && e.pointerId !== altDragPointerId)) return;
  const pointerId = altDragPointerId;
  altDragPointerId = null;
  window.timerAPI.endAltDrag();
  try {
    if (altDragCaptureElement?.hasPointerCapture(pointerId)) altDragCaptureElement.releasePointerCapture(pointerId);
  } catch (_) { /* 이미 자동 해제됨 */ }
  altDragCaptureElement = null;
}

document.addEventListener('pointerup', finishAltDrag, true);
document.addEventListener('pointercancel', finishAltDrag, true);
document.addEventListener('lostpointercapture', finishAltDrag, true);

// 클릭 통과가 켜져 있을 때: 버튼/타이틀바 위에서는 클릭을 받고,
// 그 외 배경 위에서는 클릭이 뒤 화면으로 통과되도록 마우스 위치에 따라 전환한다.
// Alt를 누르고 있으면(창을 옮기려는 의도) 배경 위여도 항상 클릭 가능 상태로 전환해 어디서든 드래그로 이동할 수 있게 한다.
document.addEventListener('mousemove', (e) => {
  if (!clickThroughEnabled || overlayActive) return;   // 알람 발동 중엔 grow()가 이미 클릭 가능 상태로 고정함
  // 네이티브 드래그 영역은 DOM 이벤트의 target이 body로 잡힐 수 있으므로 좌표로도 판정한다.
  const titlebarRect = titlebar.getBoundingClientRect();
  const overTitlebar = e.clientX >= titlebarRect.left && e.clientX <= titlebarRect.right
    && e.clientY >= titlebarRect.top && e.clientY <= titlebarRect.bottom;
  const interactive = e.altKey || overTitlebar || !!e.target.closest('button, input, select, textarea');
  const ignore = !interactive;
  if (ignore !== lastPassthroughIgnore) {
    lastPassthroughIgnore = ignore;
    window.timerAPI.setMousePassthrough(ignore);
  }
});

let alarmFullscreenOn = false;
fullscreenBtn.addEventListener('click', () => {
  alarmFullscreenOn = !alarmFullscreenOn;
  window.timerAPI.setAlarmFullscreen(alarmFullscreenOn);
  fullscreenBtn.textContent = alarmFullscreenOn ? '창 크기로' : '전체화면';
});

document.addEventListener('keydown', (e) => {
  if (overlayActive) {
    if (e.key === 'Escape' || e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); dismissAlarm(); }
    return;
  }
  if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); if (timerView.classList.contains('active')) toggleStart(); }
  else if (e.key === 'r' || e.key === 'R') { if (timerView.classList.contains('active') && !hasStarted) requestReset(); }
});

// 설정 창에서 값이 바뀌면(settings:set) 이 창으로 브로드캐스트되어 화면 표시를 동기화한다.
function applySettingsPartial(partial) {
  if ('uiTheme' in partial) applyUiTheme(partial.uiTheme);
  if ('clockFg' in partial) applyClockFg(partial.clockFg);
  if ('clockBg' in partial) applyClockBg(partial.clockBg);
  if ('showNextAlarm' in partial) { showNextAlarm = partial.showNextAlarm; updateNextAlarmLabel(); }
  if ('volume' in partial) volume = partial.volume;
  if ('muted' in partial) muted = partial.muted;
  if ('chimeSound' in partial) chimeSound = partial.chimeSound || 'none';
  if ('speak' in partial) speak = partial.speak;
  if ('timerRepeatCount' in partial) timerRepeatCount = Math.max(1, parseInt(partial.timerRepeatCount, 10) || 3);
  if ('onlineVoice' in partial) onlineVoiceEnabled = partial.onlineVoice;
  if ('onlineVoiceName' in partial) onlineVoiceName = partial.onlineVoiceName;
  if ('defaultMsg' in partial) defaultMsg = partial.defaultMsg || '알람';
  if ('timerMsg' in partial) timerMsg = partial.timerMsg || '시간 종료!';
  if ('activityName' in partial) {
    activityName = partial.activityName || '집중 시간';
    activityInput.value = activityName;
    activityLabel.textContent = activityName;
  }
  if ('overlayColor' in partial) applyOverlayColor(partial.overlayColor);
  if ('overlayScale' in partial) applyOverlayScale(partial.overlayScale);
  if ('alarmFullscreen' in partial) alarmFullscreenSetting = partial.alarmFullscreen;
  if ('autoDismissSec' in partial) autoDismissSec = Math.max(0, parseInt(partial.autoDismissSec, 10) || 0);
  if ('clickThrough' in partial) {
    clickThroughEnabled = partial.clickThrough;
    document.body.dataset.clickThrough = String(clickThroughEnabled);
    lastPassthroughIgnore = null;
  }
  if ('alarms' in partial) {
    alarms = Array.isArray(partial.alarms) ? partial.alarms : alarms;
    updateNextAlarmLabel();
  }
}
window.timerAPI.onSettingsChanged(applySettingsPartial);

// ---------- 초기화 ----------
async function init() {
  const s = await window.timerAPI.getSettings();
  applyUiTheme(s.uiThemeChosen ? s.uiTheme : 'sunny');
  volume = s.volume ?? 0.8;
  muted = !!s.muted;
  chimeSound = s.chimeSound || 'none';
  speak = s.speak !== false;
  alarms = Array.isArray(s.alarms) ? s.alarms : [];
  defaultMsg = s.defaultMsg || '알람';
  timerMsg = s.timerMsg || '시간 종료!';
  activityName = s.activityName || '집중 시간';
  activityInput.value = activityName;
  activityLabel.textContent = activityName;
  autoDismissSec = Math.max(0, parseInt(s.autoDismissSec, 10) || 0);
  onlineVoiceEnabled = s.onlineVoice !== false;
  onlineVoiceName = s.onlineVoiceName || 'ko-KR-SunHiNeural';
  const overlayColor = s.overlayColor || 'green';
  const overlayScale = s.overlayScale ?? 1;

  const clockFg = s.clockFg || 'white';
  const clockBg = s.clockBg || 'none';
  applyClockFg(clockFg);
  applyClockBg(clockBg);
  showNextAlarm = s.showNextAlarm !== false;
  timerRepeatCount = Math.max(1, parseInt(s.timerRepeatCount, 10) || 3);
  alarmFullscreenSetting = !!s.alarmFullscreen;
  applyOverlayColor(overlayColor);
  applyOverlayScale(overlayScale);

  totalSeconds = s.lastPreset ?? 300;
  remainingSeconds = totalSeconds;
  syncTimerControls();

  clickThroughEnabled = s.clickThrough ?? false;
  document.body.dataset.clickThrough = String(clickThroughEnabled);
  if (clickThroughEnabled) window.timerAPI.setClickThrough(true);

  updateClock(new Date());
  updateTimerDisplay();
  updateNextAlarmLabel();
  showView(s.view === 'timer' ? 'timer' : 'clock');
}

init();
