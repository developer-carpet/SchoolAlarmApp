const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const store = new Store({
  defaults: {
    bounds: { width: 520, height: 480, x: undefined, y: undefined },
    classroomUiV2Migrated: false,
    opacity: 0.9,
    clickThrough: false,
    alwaysOnTop: true,
    lastPreset: 300,
    volume: 0.8,
    soundId: 'bell',
    muted: false,
    view: 'clock',
    speak: true,
    alarms: [],
    defaultMsg: '알람',
    timerMsg: '시간 종료!',
    overlayColor: 'green',
    overlayScale: 1,
    autoDismissSec: 0,
    onlineVoice: true,
    onlineVoiceName: 'ko-KR-SunHiNeural',
    clockFg: 'white',
    clockBg: 'none',
    alarmOpacity: 0.85,
    showNextAlarm: true,
    timerRepeatCount: 3,
    alarmFullscreen: false,
    uiTheme: 'sunny',
    uiThemeChosen: false,
    activityName: '집중 시간',
    chimeSound: 'none'
  }
});

let win;
let settingsWin = null;      // 설정/알람 전용 창(메인 위젯과 분리되어 위젯 크기에 영향을 주지 않음)
let savedBounds = null;      // 알람 발동 전 창 크기/위치 백업
let savedClickThrough = false;
let savedWasMaximized = false;
let altDragState = null;
let clickThroughHoverTimer = null;
let nativeDragHoverActive = false;
let mouseEventsIgnored = false;

function setMainMousePassthrough(ignore) {
  if (!win || win.isDestroyed() || mouseEventsIgnored === ignore) return;
  mouseEventsIgnored = ignore;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

function stopClickThroughHoverTracking() {
  if (clickThroughHoverTimer) clearInterval(clickThroughHoverTimer);
  clickThroughHoverTimer = null;
  nativeDragHoverActive = false;
}

// 네이티브 drag 영역은 DOM mousemove를 받지 않으므로 메인 프로세스에서 상단 바 진입을 감지한다.
// 상단 바 밖의 버튼 판정은 기존 렌더러 로직에 맡겨 서로 간섭하지 않는다.
function startClickThroughHoverTracking() {
  stopClickThroughHoverTracking();
  clickThroughHoverTimer = setInterval(() => {
    if (!win || win.isDestroyed() || savedBounds) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const overTitlebar = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width
      && cursor.y >= bounds.y && cursor.y < bounds.y + Math.min(42, bounds.height);

    if (overTitlebar && !nativeDragHoverActive) {
      nativeDragHoverActive = true;
      setMainMousePassthrough(false);
    } else if (!overTitlebar && nativeDragHoverActive) {
      nativeDragHoverActive = false;
      setMainMousePassthrough(true);
    }
  }, 25);
}

function createWindow() {
  const storedBounds = store.get('bounds');
  // 큰 버튼이 들어간 교실용 준비 화면이 잘리지 않도록 기존 사용자도 최초 한 번만 넉넉하게 확장한다.
  const needsClassroomUiMigration = !store.get('classroomUiV2Migrated');
  const bounds = needsClassroomUiMigration
    ? { ...storedBounds, width: Math.max(520, storedBounds.width), height: Math.max(480, storedBounds.height) }
    : storedBounds;
  if (needsClassroomUiMigration) {
    store.set('bounds', bounds);
    store.set('classroomUiV2Migrated', true);
  }

  win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: store.get('alwaysOnTop'),
    resizable: true,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(store.get('alwaysOnTop'), 'screen-saver');
  win.setOpacity(store.get('opacity'));
  win.loadFile('index.html');

  const saveBounds = () => {
    if (win.isDestroyed()) return;
    // 알람 발동 등 '임시 확대' 상태에서는 실제 사용자 크기를 덮어쓰지 않음
    if (savedBounds) return;
    store.set('bounds', win.getBounds());
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('maximize', () => win && !win.isDestroyed() && win.webContents.send('window:maximizedChanged', true));
  win.on('unmaximize', () => win && !win.isDestroyed() && win.webContents.send('window:maximizedChanged', false));
  win.on('closed', () => {
    stopClickThroughHoverTracking();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    win = null;
  });

  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.show();
  });
}

// 설정/알람 창: 메인 위젯과 별도의 일반 창으로 띄운다.
// (예전에는 같은 창 안에서 패널을 열면서 창 자체를 키웠는데, 그러면 vh 단위로 크기가 잡힌
//  시계 글씨도 같이 커져 버리는 문제가 있었다. 별도 창이면 위젯 크기는 절대 바뀌지 않는다.)
function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin;

  const width = 380;
  const height = 640;
  const mainBounds = win ? win.getBounds() : null;
  let x, y;
  if (mainBounds) {
    const wa = screen.getDisplayNearestPoint({
      x: mainBounds.x + mainBounds.width / 2,
      y: mainBounds.y + mainBounds.height / 2
    }).workArea;
    x = mainBounds.x + mainBounds.width + 10;
    if (x + width > wa.x + wa.width) x = mainBounds.x - width - 10;
    if (x < wa.x) x = Math.round(wa.x + wa.width - width);
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - width));
    y = Math.max(wa.y, Math.min(mainBounds.y, wa.y + wa.height - height));
  }

  settingsWin = new BrowserWindow({
    x, y, width, height,
    minWidth: 320,
    minHeight: 420,
    title: '설정 · 알람',
    backgroundColor: '#1c1c20',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
  return settingsWin;
}

ipcMain.handle('settingsWindow:open', (event, tab) => {
  const w = createSettingsWindow();
  const sendTab = () => { if (tab) w.webContents.send('settingsWindow:showTab', tab); };
  if (w.webContents.isLoadingMainFrame()) w.webContents.once('did-finish-load', sendTab);
  else sendTab();
  if (win) w.setAlwaysOnTop(store.get('alwaysOnTop'), 'screen-saver');
  w.show();
  w.focus();
});

ipcMain.handle('settingsWindow:close', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('settings:get', () => store.store);

ipcMain.handle('settings:set', (event, partial) => {
  Object.entries(partial).forEach(([key, value]) => store.set(key, value));
  // 설정을 바꾼 창을 제외한 나머지 창(위젯 <-> 설정 창)에 변경 사항을 알려 화면을 동기화한다.
  BrowserWindow.getAllWindows().forEach((w) => {
    if (w.isDestroyed() || w.webContents.id === event.sender.id) return;
    w.webContents.send('settings:changed', partial);
  });
  return store.store;
});

ipcMain.handle('window:setOpacity', (event, value) => {
  store.set('opacity', value);
  // 알람 표시 중에는 알람 전용 투명도를 유지하고, 종료 후 새 값으로 복원한다.
  if (!savedBounds) win.setOpacity(value);
});

ipcMain.handle('window:setClickThrough', (event, enabled) => {
  store.set('clickThrough', enabled);
  if (savedBounds) {
    // 알람의 끄기/미루기 버튼은 계속 누를 수 있어야 한다.
    savedClickThrough = enabled;
  } else {
    setMainMousePassthrough(enabled);
    if (enabled) startClickThroughHoverTracking();
    else stopClickThroughHoverTracking();
  }
});

ipcMain.handle('window:setAlwaysOnTop', (event, enabled) => {
  // 알람 중에는 화면 위 고정을 유지하고 종료할 때 사용자가 고른 값으로 돌아간다.
  if (!savedBounds) win.setAlwaysOnTop(enabled, 'screen-saver');
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.setAlwaysOnTop(enabled, 'screen-saver');
  }
  store.set('alwaysOnTop', enabled);
});

// 컴퓨터 시작 시 자동 실행 여부 - OS(레지스트리)가 실제 상태를 갖고 있으므로 store에는 저장하지 않고 그때그때 조회/설정한다
ipcMain.handle('app:getLoginItemSettings', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('app:setLoginItemSettings', (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: []
  });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('window:minimize', () => {
  win.minimize();
});

ipcMain.handle('window:close', () => {
  win.close();
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!win || win.isDestroyed()) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('window:setMaximized', (event, enabled) => {
  if (!win || win.isDestroyed()) return false;
  if (enabled && !win.isMaximized()) win.maximize();
  if (!enabled && win.isMaximized()) win.unmaximize();
  return win.isMaximized();
});

// Alt+드래그 전용: 시작 당시 창 위치와 현재 커서의 절대 차이를 사용한다.
// 매 이벤트마다 직전 위치에 덧셈하지 않아 IPC가 일부 합쳐져도 커서를 정확히 따라간다.
ipcMain.on('window:altDragStart', (event, screenX, screenY) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  const [x, y] = win.getPosition();
  altDragState = { x, y, screenX, screenY };
});

ipcMain.on('window:altDragMove', (event, screenX, screenY) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || !altDragState) return;
  const x = Math.round(altDragState.x + screenX - altDragState.screenX);
  const y = Math.round(altDragState.y + screenY - altDragState.screenY);
  win.setPosition(x, y);
});

ipcMain.on('window:altDragEnd', (event) => {
  if (win && !win.isDestroyed() && event.sender === win.webContents) altDragState = null;
});

// 클릭 통과 중 마우스가 버튼/입력창/패널 위에 있을 때만 클릭을 받도록 즉시 전환
ipcMain.handle('window:setMousePassthrough', (event, ignore) => {
  setMainMousePassthrough(ignore);
});

ipcMain.handle('window:flash', () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});

// 인터넷 연결 시 Edge의 고품질 온라인 음성으로 합성. 실패/시간초과 시 null 반환(렌더러가 오프라인 음성으로 폴백).
ipcMain.handle('tts:synthesizeEdge', async (event, { text, voice }) => {
  if (!text) return null;
  try {
    const result = await Promise.race([
      (async () => {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voice || 'ko-KR-SunHiNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text);
        const chunks = [];
        return await new Promise((resolve, reject) => {
          audioStream.on('data', (c) => chunks.push(c));
          audioStream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
          audioStream.on('error', reject);
        });
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('tts-timeout')), 6000))
    ]);
    return result;
  } catch (e) {
    return null;
  }
});

// 알람 발동 시 기본으로 뜨는 중앙 박스 크기 계산(현재 창이 있는 모니터 기준)
function computeOverlayBoxBounds() {
  const cur = win.getBounds();
  const center = { x: Math.round(cur.x + cur.width / 2), y: Math.round(cur.y + cur.height / 2) };
  const disp = screen.getDisplayNearestPoint(center);
  const wa = disp.workArea;
  const width = Math.min(760, Math.round(wa.width * 0.6));
  const height = Math.min(520, Math.round(wa.height * 0.6));
  const x = Math.round(wa.x + (wa.width - width) / 2);
  const y = Math.round(wa.y + (wa.height - height) / 2);
  return { x, y, width, height };
}

// 알람 발동: 현재 크기/위치를 저장하고 창을 크게 키워 화면 중앙에 표시
ipcMain.handle('window:grow', () => {
  if (!win || win.isDestroyed()) return;
  if (!savedBounds) {
    savedWasMaximized = win.isMaximized();
    savedBounds = savedWasMaximized ? win.getNormalBounds() : win.getBounds();
    savedClickThrough = store.get('clickThrough');
  }
  if (win.isMaximized()) win.unmaximize();
  // 알람 중에는 클릭이 통과되면 끄기 버튼을 못 누르므로 잠시 해제
  setMainMousePassthrough(false);
  // 알람 화면은 평소 투명도와 별개로, 설정된 알람 전용 투명도(기본 반투명)를 사용
  win.setOpacity(store.get('alarmOpacity'));

  if (!win.isVisible()) win.show();
  win.setBounds(computeOverlayBoxBounds(), true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  win.flashFrame(true);
});

// 알람 화면 전체화면 전환: transparent 창은 실제 OS 최대화(win.maximize())를 하면
// 윈도우에서 투명 합성이 깨져 배경이 갑자기 불투명해지는 문제가 있다.
// 그래서 실제로 최대화하는 대신 현재 모니터의 작업영역 크기에 맞춰 창 크기만 키운다(투명도 유지).
ipcMain.handle('window:setAlarmFullscreen', (event, enabled) => {
  if (!win || win.isDestroyed()) return false;
  if (enabled) {
    const cur = win.getBounds();
    const center = { x: Math.round(cur.x + cur.width / 2), y: Math.round(cur.y + cur.height / 2) };
    const wa = screen.getDisplayNearestPoint(center).workArea;
    win.setBounds(wa, true);
  } else {
    win.setBounds(computeOverlayBoxBounds(), true);
  }
  return enabled;
});

// 알람 종료: 원래 크기/위치로 복원
ipcMain.handle('window:restore', () => {
  if (!win || win.isDestroyed()) return;
  if (savedBounds) {
    if (win.isMaximized()) win.unmaximize();
    win.setBounds(savedBounds, true);
    win.setAlwaysOnTop(store.get('alwaysOnTop'), 'screen-saver');
    win.setOpacity(store.get('opacity'));
    if (savedClickThrough) {
      setMainMousePassthrough(true);
      startClickThroughHoverTracking();
    } else {
      stopClickThroughHoverTracking();
      setMainMousePassthrough(false);
    }
    if (savedWasMaximized) win.maximize();
    savedBounds = null;
    savedWasMaximized = false;
  }
  win.flashFrame(false);
});
