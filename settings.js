const $ = (id) => document.getElementById(id);
const tabs = document.querySelectorAll('.tab');
const settingsPage = $('settingsPage');
const alarmPage = $('alarmPage');
const themePicker = $('themePicker');

const alwaysOnTopChk = $('alwaysOnTopChk');
const startupChk = $('startupChk');
const clickThroughChk = $('clickThroughChk');
const opacityRange = $('opacityRange');
const clockFgInput = $('clockFgInput');
const clockBgInput = $('clockBgInput');
const showNextAlarmChk = $('showNextAlarmChk');
const volumeRange = $('volumeRange');
const muteChk = $('muteChk');
const chimeSoundInput = $('chimeSoundInput');
const previewChimeBtn = $('previewChimeBtn');
const speakChk = $('speakChk');
const timerRepeatCountInput = $('timerRepeatCountInput');
const onlineVoiceChk = $('onlineVoiceChk');
const onlineVoiceNameInput = $('onlineVoiceNameInput');
const previewVoiceBtn = $('previewVoiceBtn');
const defaultMsgInput = $('defaultMsgInput');
const timerMsgInput = $('timerMsgInput');
const overlayColorInput = $('overlayColorInput');
const overlayScaleInput = $('overlayScaleInput');
const alarmOpacityInput = $('alarmOpacityInput');
const alarmFullscreenChk = $('alarmFullscreenChk');
const autoDismissInput = $('autoDismissInput');

const alarmTimeInput = $('alarmTimeInput');
const alarmRepeatInput = $('alarmRepeatInput');
const alarmDaysPicker = $('alarmDaysPicker');
const alarmMsgInput = $('alarmMsgInput');
const alarmRepeatCountInput = $('alarmRepeatCountInput');
const addAlarmBtn = $('addAlarmBtn');
const cancelEditBtn = $('cancelEditBtn');
const alarmList = $('alarmList');
const bulkInput = $('bulkInput');
const bulkRepeatInput = $('bulkRepeatInput');
const bulkDaysPicker = $('bulkDaysPicker');
const bulkRepeatCountInput = $('bulkRepeatCountInput');
const bulkAddBtn = $('bulkAddBtn');
const fillTemplateBtn = $('fillTemplateBtn');
const clearAllBtn = $('clearAllBtn');

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const UI_THEMES = new Set(['classic', 'sunny', 'forest', 'space']);
const TIMETABLE_TEMPLATE = [
  '08:40 아침 활동', '09:00 1교시 시작', '09:40 1교시 끝 · 쉬는 시간',
  '09:50 2교시 시작', '10:30 2교시 끝 · 쉬는 시간', '10:40 3교시 시작',
  '11:20 3교시 끝 · 쉬는 시간', '11:30 4교시 시작', '12:10 4교시 끝 · 점심시간',
  '13:10 5교시 시작', '13:50 5교시 끝 · 쉬는 시간', '14:00 6교시 시작',
  '14:40 6교시 끝 · 하교'
].join('\n');

let alarms = [];
let editingAlarmId = null;
let currentTheme = 'sunny';

function pad(n) { return String(n).padStart(2, '0'); }

// ---------- 알림음(차임) 미리듣기: 외부 파일 없이 Web Audio API로 생성 ----------
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
function playChime(type, vol) {
  if (!type || type === 'none') return;
  try {
    const ctx = getChimeCtx();
    const now = ctx.currentTime;
    const gainValue = Math.min(1, typeof vol === 'number' ? vol : 0.8) * 0.5;
    if (type === 'chime') {
      playTone(ctx, 880, now, 0.5, 'sine', gainValue);
      playTone(ctx, 1318.5, now + 0.18, 0.6, 'sine', gainValue);
    } else if (type === 'bell') {
      [0, 0.35, 0.7].forEach((t) => playTone(ctx, 1046.5, now + t, 0.3, 'triangle', gainValue));
    } else if (type === 'xylophone') {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => playTone(ctx, freq, now + i * 0.13, 0.35, 'triangle', gainValue * 0.9));
    }
  } catch (_) { /* 오디오 장치 없음 등 */ }
}

function showTab(name) {
  const tab = name === 'alarm' ? 'alarm' : 'settings';
  tabs.forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  settingsPage.classList.toggle('active', tab === 'settings');
  alarmPage.classList.toggle('active', tab === 'alarm');
  document.title = tab === 'alarm' ? '교실 타이머 알람' : '교실 타이머 설정';
}

tabs.forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
window.timerAPI.onShowTab(showTab);

function applyTheme(theme) {
  currentTheme = UI_THEMES.has(theme) ? theme : 'classic';
  document.body.dataset.uiTheme = currentTheme;
  themePicker.querySelectorAll('.theme-card').forEach((card) => {
    const selected = card.dataset.theme === currentTheme;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
  const themeControlsColors = currentTheme !== 'classic';
  [clockFgInput, clockBgInput, overlayColorInput].forEach((input) => {
    input.disabled = themeControlsColors;
    input.title = themeControlsColors ? '현재 테마에서 자동으로 정해지는 항목입니다.' : '';
  });
}

themePicker.addEventListener('click', (event) => {
  const card = event.target.closest('.theme-card');
  if (!card) return;
  applyTheme(card.dataset.theme);
  window.timerAPI.setSettings({ uiTheme: currentTheme, uiThemeChosen: true });
});

function selectedDays(picker) {
  return [...picker.querySelectorAll('.day-btn.selected')].map((button) => Number(button.dataset.day));
}

function setSelectedDays(picker, days = []) {
  picker.querySelectorAll('.day-btn').forEach((button) => {
    button.classList.toggle('selected', days.includes(Number(button.dataset.day)));
  });
}

document.querySelectorAll('.day-btn').forEach((button) => {
  button.addEventListener('click', () => button.classList.toggle('selected'));
});

function repeatLabel(alarm) {
  if (alarm.repeat === 'custom') {
    const days = Array.isArray(alarm.days) ? alarm.days : [];
    return DAY_ORDER.filter((day) => days.includes(day)).map((day) => WEEKDAY_KO[day]).join('') || '요일 미선택';
  }
  return alarm.repeat === 'daily' ? '매일' : alarm.repeat === 'weekdays' ? '평일' : '한 번';
}

function persistAlarms() {
  window.timerAPI.setSettings({ alarms });
}

function resetAlarmForm() {
  editingAlarmId = null;
  alarmTimeInput.value = '';
  alarmMsgInput.value = '';
  alarmRepeatInput.value = 'once';
  alarmRepeatCountInput.value = 3;
  alarmDaysPicker.classList.remove('show');
  setSelectedDays(alarmDaysPicker);
  addAlarmBtn.textContent = '알람 추가';
  cancelEditBtn.style.display = 'none';
}

function startEditAlarm(alarm) {
  editingAlarmId = alarm.id;
  alarmTimeInput.value = alarm.time;
  alarmMsgInput.value = alarm.msg || '';
  alarmRepeatInput.value = alarm.repeat || 'once';
  alarmRepeatCountInput.value = alarm.repeatCount || 3;
  alarmDaysPicker.classList.toggle('show', alarm.repeat === 'custom');
  setSelectedDays(alarmDaysPicker, Array.isArray(alarm.days) ? alarm.days : []);
  addAlarmBtn.textContent = '수정 저장';
  cancelEditBtn.style.display = '';
  showTab('alarm');
  alarmTimeInput.focus();
}

function addAlarm() {
  const time = alarmTimeInput.value;
  if (!time) { alarmTimeInput.focus(); return; }
  const repeat = alarmRepeatInput.value;
  const repeatCount = Math.max(1, Number.parseInt(alarmRepeatCountInput.value, 10) || 3);
  const days = repeat === 'custom' ? selectedDays(alarmDaysPicker) : undefined;
  if (repeat === 'custom' && days.length === 0) { alert('요일을 하나 이상 선택하세요.'); return; }

  if (editingAlarmId) {
    const alarm = alarms.find((item) => item.id === editingAlarmId);
    if (alarm) Object.assign(alarm, { time, msg: alarmMsgInput.value.trim(), repeat, days, repeatCount });
  } else {
    alarms.push({ id: `a-${Date.now()}`, time, msg: alarmMsgInput.value.trim(), repeat, days, repeatCount, enabled: true });
  }
  resetAlarmForm();
  persistAlarms();
  renderAlarms();
}

function deleteAlarm(id) {
  alarms = alarms.filter((alarm) => alarm.id !== id);
  if (editingAlarmId === id) resetAlarmForm();
  persistAlarms();
  renderAlarms();
}

function toggleAlarm(id) {
  const alarm = alarms.find((item) => item.id === id);
  if (!alarm) return;
  alarm.enabled = !alarm.enabled;
  persistAlarms();
  renderAlarms();
}

function renderAlarms() {
  alarmList.replaceChildren();
  const sorted = [...alarms].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'alarm-empty';
    empty.textContent = '등록된 알람이 없습니다';
    alarmList.appendChild(empty);
    return;
  }
  sorted.forEach((alarm) => {
    const row = document.createElement('div');
    row.className = `alarm-item${alarm.enabled ? '' : ' off'}`;

    const enabled = document.createElement('input');
    enabled.type = 'checkbox'; enabled.checked = !!alarm.enabled; enabled.title = '켜기/끄기';
    enabled.addEventListener('change', () => toggleAlarm(alarm.id));
    const time = document.createElement('div'); time.className = 'a-time'; time.textContent = alarm.time;
    const meta = document.createElement('div'); meta.className = 'a-meta';
    const msg = document.createElement('div'); msg.className = 'a-msg'; msg.textContent = alarm.msg || '(메시지 없음)';
    const repeat = document.createElement('div'); repeat.className = 'a-rep'; repeat.textContent = `${repeatLabel(alarm)} · ${alarm.repeatCount || 3}회 안내`;
    meta.append(msg, repeat);
    const edit = document.createElement('button'); edit.className = 'icon-action'; edit.textContent = '✏'; edit.title = '수정';
    edit.addEventListener('click', () => startEditAlarm(alarm));
    const remove = document.createElement('button'); remove.className = 'icon-action delete'; remove.textContent = '🗑'; remove.title = '삭제';
    remove.addEventListener('click', () => deleteAlarm(alarm.id));
    row.append(enabled, time, meta, edit, remove);
    alarmList.appendChild(row);
  });
}

function bulkAdd() {
  const repeat = bulkRepeatInput.value;
  const repeatCount = Math.max(1, Number.parseInt(bulkRepeatCountInput.value, 10) || 3);
  const days = repeat === 'custom' ? selectedDays(bulkDaysPicker) : undefined;
  if (repeat === 'custom' && days.length === 0) { alert('요일을 하나 이상 선택하세요.'); return; }
  let added = 0;
  const bad = [];
  bulkInput.value.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const match = line.match(/^(\d{1,2}):(\d{2})\s*(.*)$/);
    if (!match) { bad.push(line); return; }
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (hour > 23 || minute > 59) { bad.push(line); return; }
    alarms.push({
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      time: `${pad(hour)}:${pad(minute)}`, msg: (match[3] || '').trim(), repeat, days, repeatCount, enabled: true
    });
    added += 1;
  });
  if (added) bulkInput.value = '';
  persistAlarms();
  renderAlarms();
  if (bad.length) alert(`${added}개 등록됨.\n형식이 맞지 않아 건너뛴 줄:\n${bad.join('\n')}`);
}

function clearAllAlarms() {
  if (!alarms.length || !confirm(`알람 ${alarms.length}개를 모두 삭제할까요?`)) return;
  alarms = [];
  resetAlarmForm();
  persistAlarms();
  renderAlarms();
}

alwaysOnTopChk.addEventListener('change', async () => {
  await window.timerAPI.setAlwaysOnTop(alwaysOnTopChk.checked);
  window.timerAPI.setSettings({ alwaysOnTop: alwaysOnTopChk.checked });
});
startupChk.addEventListener('change', async () => {
  startupChk.checked = await window.timerAPI.setLoginItemSettings(startupChk.checked);
});
clickThroughChk.addEventListener('change', async () => {
  await window.timerAPI.setClickThrough(clickThroughChk.checked);
  window.timerAPI.setSettings({ clickThrough: clickThroughChk.checked });
});
opacityRange.addEventListener('input', () => window.timerAPI.setOpacity(Number.parseFloat(opacityRange.value)));
clockFgInput.addEventListener('change', () => window.timerAPI.setSettings({ clockFg: clockFgInput.value }));
clockBgInput.addEventListener('change', () => window.timerAPI.setSettings({ clockBg: clockBgInput.value }));
showNextAlarmChk.addEventListener('change', () => window.timerAPI.setSettings({ showNextAlarm: showNextAlarmChk.checked }));
volumeRange.addEventListener('input', () => window.timerAPI.setSettings({ volume: Number.parseFloat(volumeRange.value) }));
muteChk.addEventListener('change', () => window.timerAPI.setSettings({ muted: muteChk.checked }));
chimeSoundInput.addEventListener('change', () => window.timerAPI.setSettings({ chimeSound: chimeSoundInput.value }));
previewChimeBtn.addEventListener('click', () => playChime(chimeSoundInput.value, Number.parseFloat(volumeRange.value)));
speakChk.addEventListener('change', () => window.timerAPI.setSettings({ speak: speakChk.checked }));
timerRepeatCountInput.addEventListener('change', () => window.timerAPI.setSettings({ timerRepeatCount: Math.max(1, Number.parseInt(timerRepeatCountInput.value, 10) || 3) }));
onlineVoiceChk.addEventListener('change', () => window.timerAPI.setSettings({ onlineVoice: onlineVoiceChk.checked }));
onlineVoiceNameInput.addEventListener('change', () => window.timerAPI.setSettings({ onlineVoiceName: onlineVoiceNameInput.value }));
defaultMsgInput.addEventListener('input', () => window.timerAPI.setSettings({ defaultMsg: defaultMsgInput.value.trim() || '알람' }));
timerMsgInput.addEventListener('input', () => window.timerAPI.setSettings({ timerMsg: timerMsgInput.value.trim() || '시간 종료!' }));
overlayColorInput.addEventListener('change', () => window.timerAPI.setSettings({ overlayColor: overlayColorInput.value }));
overlayScaleInput.addEventListener('input', () => window.timerAPI.setSettings({ overlayScale: Number.parseFloat(overlayScaleInput.value) }));
alarmOpacityInput.addEventListener('input', () => window.timerAPI.setSettings({ alarmOpacity: Number.parseFloat(alarmOpacityInput.value) }));
alarmFullscreenChk.addEventListener('change', () => window.timerAPI.setSettings({ alarmFullscreen: alarmFullscreenChk.checked }));
autoDismissInput.addEventListener('change', () => window.timerAPI.setSettings({ autoDismissSec: Math.max(0, Number.parseInt(autoDismissInput.value, 10) || 0) }));

previewVoiceBtn.addEventListener('click', async () => {
  previewVoiceBtn.disabled = true;
  previewVoiceBtn.textContent = '재생 중...';
  const sample = '예시 문장입니다. 3교시 끝, 쉬는 시간입니다.';
  try {
    let played = false;
    if (onlineVoiceChk.checked) {
      const audioData = await window.timerAPI.synthesizeEdge(sample, onlineVoiceNameInput.value);
      if (audioData) {
        const audio = new Audio(`data:audio/mpeg;base64,${audioData}`);
        audio.volume = Number.parseFloat(volumeRange.value) || 0.8;
        await audio.play();
        played = true;
      }
    }
    if (!played && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(sample);
      utterance.lang = 'ko-KR'; utterance.volume = Number.parseFloat(volumeRange.value) || 0.8;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
    }
  } catch (_) { /* 음성 장치나 네트워크가 없어도 설정 창은 계속 사용할 수 있다. */ }
  finally { previewVoiceBtn.disabled = false; previewVoiceBtn.textContent = '미리 듣기'; }
});

addAlarmBtn.addEventListener('click', addAlarm);
cancelEditBtn.addEventListener('click', resetAlarmForm);
alarmMsgInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') addAlarm(); });
alarmRepeatInput.addEventListener('change', () => alarmDaysPicker.classList.toggle('show', alarmRepeatInput.value === 'custom'));
bulkRepeatInput.addEventListener('change', () => bulkDaysPicker.classList.toggle('show', bulkRepeatInput.value === 'custom'));
bulkAddBtn.addEventListener('click', bulkAdd);
fillTemplateBtn.addEventListener('click', () => { bulkInput.value = TIMETABLE_TEMPLATE; });
clearAllBtn.addEventListener('click', clearAllAlarms);

function applySettings(partial) {
  if ('uiTheme' in partial || 'uiThemeChosen' in partial) applyTheme(partial.uiThemeChosen === false ? 'sunny' : (partial.uiTheme || currentTheme));
  if ('alwaysOnTop' in partial) alwaysOnTopChk.checked = !!partial.alwaysOnTop;
  if ('clickThrough' in partial) clickThroughChk.checked = !!partial.clickThrough;
  if ('opacity' in partial) opacityRange.value = partial.opacity;
  if ('clockFg' in partial) clockFgInput.value = partial.clockFg;
  if ('clockBg' in partial) clockBgInput.value = partial.clockBg;
  if ('showNextAlarm' in partial) showNextAlarmChk.checked = partial.showNextAlarm !== false;
  if ('volume' in partial) volumeRange.value = partial.volume;
  if ('muted' in partial) muteChk.checked = !!partial.muted;
  if ('chimeSound' in partial) chimeSoundInput.value = partial.chimeSound || 'none';
  if ('speak' in partial) speakChk.checked = partial.speak !== false;
  if ('timerRepeatCount' in partial) timerRepeatCountInput.value = partial.timerRepeatCount;
  if ('onlineVoice' in partial) onlineVoiceChk.checked = partial.onlineVoice !== false;
  if ('onlineVoiceName' in partial) onlineVoiceNameInput.value = partial.onlineVoiceName;
  if ('defaultMsg' in partial) defaultMsgInput.value = partial.defaultMsg || '알람';
  if ('timerMsg' in partial) timerMsgInput.value = partial.timerMsg || '시간 종료!';
  if ('overlayColor' in partial) overlayColorInput.value = partial.overlayColor;
  if ('overlayScale' in partial) overlayScaleInput.value = partial.overlayScale;
  if ('alarmOpacity' in partial) alarmOpacityInput.value = partial.alarmOpacity;
  if ('alarmFullscreen' in partial) alarmFullscreenChk.checked = !!partial.alarmFullscreen;
  if ('autoDismissSec' in partial) autoDismissInput.value = partial.autoDismissSec;
  if ('alarms' in partial) { alarms = Array.isArray(partial.alarms) ? partial.alarms : []; renderAlarms(); }
}

window.timerAPI.onSettingsChanged(applySettings);

async function init() {
  const settings = await window.timerAPI.getSettings();
  applySettings(settings);
  try { startupChk.checked = await window.timerAPI.getLoginItemSettings(); }
  catch (_) { startupChk.checked = false; }
  renderAlarms();
}

init();
