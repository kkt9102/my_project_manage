const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { discover, inspect } = require('./projects.cjs');

app.setName('ProjectManage');
if (!app.requestSingleInstanceLock()) app.exit(0);
const initial = () => ({ projects: [], account: null, repos: [], syncedAt: null, secret: null });
let state = initial();
let stateFile;
let window;
let queue = Promise.resolve();
let device = null;

async function save(next) {
  const tmp = stateFile + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(tmp, stateFile);
    state = next;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

function snapshot() {
  const { projects, account, repos, syncedAt } = state;
  return { projects, account, repos, syncedAt };
}

async function request(url, options) {
  try {
    return await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000), ...options });
  } catch { throw Error('GitHub에 연결할 수 없어요. 네트워크를 확인해 주세요.'); }
}

async function api(route, token) {
  const response = await request('https://api.github.com' + route, {
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
  });
  if (!response.ok) {
    if (response.status === 401) throw Error('GitHub 인증이 만료됐어요. 계정을 다시 연결해 주세요.');
    if (response.status === 403 || response.status === 429) throw Error('GitHub 접근 권한이나 요청 한도를 확인해 주세요.');
    throw Error('GitHub 저장소를 불러오지 못했어요.');
  }
  return { data: await response.json(), next: /rel="next"/.test(response.headers.get('link') ?? '') };
}

async function repositories(token) {
  const repos = [];
  for (let page = 1; ; page++) {
    const { data, next } = await api('/user/repos?per_page=100&sort=updated&page=' + page, token);
    for (const repo of data) {
      if (/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) {
        repos.push({ id: repo.id, name: repo.name, slug: repo.full_name, private: repo.private, language: repo.language });
      }
    }
    if (!next) return repos;
  }
}

async function connect(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{15,255}$/.test(token)) throw Error('GitHub 인증 정보를 확인해 주세요.');
  const { data } = await api('/user', token);
  if (typeof data.login !== 'string') throw Error('GitHub 계정 정보를 확인할 수 없어요.');
  const [repos, encrypted] = await Promise.all([repositories(token), safeStorage.encryptStringAsync(token)]);
  await save({ ...state, account: { login: data.login }, repos, syncedAt: new Date().toISOString(), secret: encrypted.toString('base64') });
  return snapshot();
}

async function oauth(endpoint, fields) {
  const response = await request('https://github.com/login/' + endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams(fields),
  });
  if (!response.ok) throw Error('GitHub 앱의 클라이언트 ID와 기기 흐름 설정을 확인해 주세요.');
  return response.json();
}

const handlers = {
  snapshot,
  async choose() {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: '개발 프로젝트 폴더 선택' });
    return result.canceled ? null : discover(result.filePaths[0]);
  },
  async register(folder, slug) {
    const item = await inspect(folder);
    if (!item) throw Error('이 폴더에서 개발 소스를 찾지 못했어요.');
    if (slug && !item.git.github.includes(slug.toLowerCase())) throw Error('선택한 폴더의 Git 원격 주소가 이 GitHub 저장소와 일치하지 않아요.');
    await save({ ...state, projects: [...state.projects.filter(p => p.path !== item.path), item] });
    return snapshot();
  },
  async refresh(folder) {
    const projects = [];
    for (const old of state.projects) {
      if (folder && old.path !== folder) { projects.push(old); continue; }
      const item = await inspect(old.path).catch(() => null);
      projects.push(item ?? { ...old, unavailable: true });
    }
    await save({ ...state, projects });
    return snapshot();
  },
  async remove(folder) {
    await save({ ...state, projects: state.projects.filter(p => p.path !== folder) });
    return snapshot();
  },
  async open(folder, method) {
    const project = state.projects.find(p => p.path === folder);
    if (!project) throw Error('먼저 폴더를 등록해 주세요.');
    if (method === 'code') {
      const encoded = project.path.replaceAll('\\', '/').split('/').map((part, index) => index === 0 && /^[A-Z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/');
      await shell.openExternal('vscode://file' + (encoded.startsWith('/') ? '' : '/') + encoded);
    } else {
      const error = await shell.openPath(project.path);
      if (error) throw Error('폴더를 열 수 없어요. 경로를 확인해 주세요.');
    }
  },
  async openRepo(slug) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug) || (!state.repos.some(r => r.slug === slug) && !state.projects.some(p => p.git.github.includes(slug)))) {
      throw Error('저장소 주소를 확인할 수 없어요.');
    }
    await shell.openExternal('https://github.com/' + slug);
  },
  connect,
  async startDevice(clientId) {
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_]{10,100}$/.test(clientId)) throw Error('GitHub App 클라이언트 ID를 확인해 주세요.');
    const data = await oauth('device/code', { client_id: clientId });
    if (!data.device_code || !data.user_code || data.verification_uri !== 'https://github.com/login/device') throw Error('GitHub에서 기기 코드를 받지 못했어요.');
    const interval = Math.max(5, Number(data.interval) || 5);
    device = { clientId, code: data.device_code, until: Date.now() + data.expires_in * 1000, interval, next: Date.now() + interval * 1000 };
    return { code: data.user_code, interval };
  },
  async openDevice() { await shell.openExternal('https://github.com/login/device'); },
  async pollDevice() {
    if (!device || Date.now() > device.until) { device = null; throw Error('기기 코드가 만료됐어요. 다시 연결해 주세요.'); }
    if (Date.now() < device.next) return { interval: Math.ceil((device.next - Date.now()) / 1000) };
    const data = await oauth('oauth/access_token', { client_id: device.clientId, device_code: device.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (data.error === 'slow_down') device.interval += 5;
    if (['slow_down', 'authorization_pending'].includes(data.error)) {
      device.next = Date.now() + device.interval * 1000;
      return { interval: device.interval };
    }
    device = null;
    if (!data.access_token) throw Error('GitHub에서 연결을 승인하지 않았어요. 다시 시도해 주세요.');
    return { snapshot: await connect(data.access_token) };
  },
  cancelDevice() { device = null; },
  async sync() {
    if (!state.secret) throw Error('먼저 GitHub 계정을 연결해 주세요.');
    let secret;
    try { secret = (await safeStorage.decryptStringAsync(Buffer.from(state.secret, 'base64'))).decryptedString; }
    catch { throw Error('저장한 인증 정보를 열 수 없어요. 계정을 다시 연결해 주세요.'); }
    const repos = await repositories(secret);
    await save({ ...state, repos, syncedAt: new Date().toISOString() });
    return snapshot();
  },
  async disconnect() {
    device = null;
    await save({ ...state, account:null, repos:[], syncedAt:null, secret:null });
    return snapshot();
  },
};

app.whenReady().then(async () => {
  const dir = app.getPath('userData');
  await fs.mkdir(dir, { recursive: true });
  stateFile = path.join(dir, 'projects.json');
  try { state = { ...initial(), ...JSON.parse(await fs.readFile(stateFile, 'utf8')) }; }
  catch (error) {
    if (error.code !== 'ENOENT') {
      dialog.showErrorBox('ProjectManage', '저장된 목록을 읽을 수 없어요. 데이터 파일을 확인해 주세요.');
      app.quit();
      return;
    }
  }

  window = new BrowserWindow({
    width: 1120, height: 785, minWidth: 780, minHeight: 560, backgroundColor: '#F7F7FC',
    title: 'ProjectManage', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());

  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle('projects:' + name, (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('허용되지 않은 요청입니다.');
      const result = queue.then(() => handler(...args));
      queue = result.catch(() => {});
      return result;
    });
  }
  await window.loadFile(path.join(__dirname, 'index.html'));
}).catch(() => { dialog.showErrorBox('ProjectManage', '앱을 시작하지 못했어요.'); app.quit(); });

app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});
