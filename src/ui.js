const api = window.projects;
const view = document.querySelector('#view');
const modal = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const tabs = [...document.querySelectorAll('[role=tab]')];
let data = { projects: [], repos: [], account: null };
let active = 'local';
let query = '';
let filters = ['', ''];
let noticeTimer;
let deviceSession = 0;

function node(tag, className, content) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content != null) item.textContent = content;
  return item;
}

function group(tag, className, ...children) {
  const item = node(tag, className);
  item.append(...children);
  return item;
}

function icon(filename) {
  const image = node('img');
  image.src = filename;
  image.alt = '';
  return image;
}

function button(label, callback, kind = '', title = '') {
  const item = node('button', kind, label);
  item.type = 'button';
  item.title = title;
  item.addEventListener('click', async () => {
    item.disabled = true;
    try { await callback(); }
    catch (error) { notify(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); }
    finally { item.disabled = false; }
  });
  return item;
}

function notify(message, error = false) {
  notice.textContent = message;
  notice.classList.toggle('error', error);
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 6500);
}

function update(snapshot) {
  data = snapshot;
  render();
}

function displayDate(date) {
  return date ? new Intl.DateTimeFormat('ko', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : '—';
}

function gitStatus(project) {
  if (project.git.state === 'unavailable') return 'Git 확인 불가';
  if (project.git.state === 'none') return 'Git 미사용';
  if (project.git.github.length) return 'GitHub';
  return project.git.remote ? '원격 설정됨' : '원격 없음';
}

function localFolders(slug) {
  return data.projects.filter(p => !p.unavailable && p.git.github.includes(slug.toLowerCase()));
}

function select(label, entries, current, change) {
  const item = node('select');
  item.setAttribute('aria-label', label);
  item.append(new Option(label + ' · 전체', ''), ...entries.map(name => new Option(name, name)));
  item.value = current;
  item.addEventListener('change', () => change(item.value));
  return item;
}

function toolbar(remote, listRegion) {
  const input = node('input');
  input.type = 'search';
  input.value = query;
  input.placeholder = remote ? '저장소 이름 검색' : '프로젝트 이름 또는 경로 검색';
  input.setAttribute('aria-label', input.placeholder);
  input.addEventListener('input', () => {
    query = input.value;
    renderResults(listRegion, remote);
  });
  const categories = remote ? ['공개', '비공개'] : [...new Set(data.projects.map(p => p.type))].sort();
  if (filters[0] && !categories.includes(filters[0])) filters[0] = '';
  const flags = remote ? ['로컬에 등록됨', '미등록'] : ['GitHub', '원격 설정됨', '원격 없음', 'Git 미사용', 'Git 확인 불가'];
  const filter = (index, value) => { filters[index] = value; renderResults(listRegion, remote); };
  return group('div', 'toolbar',
    group('label', 'search', icon('search.svg'), input),
    select(remote ? '공개 범위' : '프로젝트 종류', categories, filters[0], value => filter(0, value)),
    select(remote ? '로컬 연결' : 'Git 상태', flags, filters[1], value => filter(1, value)));
}

function projectHeading(title, subtitle, action) {
  const heading = group('div', 'heading', group('div', '', node('h1', '', title), node('p', '', subtitle)));
  if (action) heading.append(action);
  return heading;
}

function table(remote, items) {
  const columns = remote ? ['저장소', '공개 범위', '주 언어', '로컬 폴더', '작업'] : ['프로젝트', '종류', '버전', 'Git 브랜치', '원격 저장소', '작업'];
  const row = node('tr');
  for (const label of columns) {
    const th = node('th', '', label);
    th.scope = 'col';
    row.append(th);
  }
  const name = (title, subtitle) => {
    const detail = node('span', 'muted path', subtitle);
    detail.title = subtitle;
    return group('div', 'identity', node('strong', '', title), detail);
  };
  const status = (label, positive) => node('span', positive ? 'chip' : 'chip neutral', label);
  const td = item => typeof item === 'string' ? node('td', '', item) : group('td', '', item);
  const body = node('tbody');
  for (const project of items) {
    if (remote) {
      const folders = localFolders(project.slug);
      const action = folders.length
        ? button('로컬에서 열기', () => folders.length === 1 ? api.open(folders[0].path, 'folder') : showFolders(folders), 'link')
        : button('폴더 연결', () => registerFlow(project), 'link');
      body.append(group('tr', '', ...[
        name(project.name, project.slug), project.private ? '비공개' : '공개',
        project.language ?? '—', status(folders.length ? '로컬에 등록됨' : '미등록', folders.length),
        group('div', 'actions', action, button('GitHub ↗', () => api.openRepo(project.slug), 'link', 'GitHub에서 열기')),
      ].map(td)));
    } else {
      body.append(group('tr', '', ...[
        name(project.name, project.unavailable ? '확인 필요 · ' + project.path : project.path),
        project.type, project.version ?? '—', project.git.branch ?? '—', status(gitStatus(project), project.git.github.length),
        group('div', 'actions', button('VS Code로 열기', () => api.open(project.path, 'code'), 'link'),
          button('···', () => projectMenu(project), 'link more', '프로젝트 작업')),
      ].map(td)));
    }
  }
  return group('div', 'table-shell', group('table', remote ? 'remote-table' : 'local-table', group('thead', '', row), body));
}

function renderResults(region, remote) {
  const needle = query.trim().toLowerCase();
  const entries = (remote ? data.repos : data.projects).filter(item => {
    const hay = (item.name + ' ' + (remote ? item.slug : item.path)).toLowerCase();
    const category = remote ? (item.private ? '비공개' : '공개') : item.type;
    const flag = remote ? (localFolders(item.slug).length ? '로컬에 등록됨' : '미등록') : gitStatus(item);
    return hay.includes(needle) && (!filters[0] || filters[0] === category) && (!filters[1] || filters[1] === flag);
  });
  const latest = remote ? data.syncedAt : data.projects.reduce((date, item) => !date || item.checkedAt > date ? item.checkedAt : date, null);
  const tool = remote ? button('계정 관리', accountMenu) : button('새로고침', async () => { update(await api.refresh()); notify('로컬 프로젝트 정보를 확인했어요.'); });
  const summary = group('div', 'summary', node('strong', '', entries.length + '개 ' + (remote ? '저장소' : '프로젝트')),
    group('div', 'actions', node('span', 'muted', (remote ? '마지막 동기화 · ' : '마지막 확인 · ') + displayDate(latest)), tool));
  const empty = query || filters.some(Boolean) ? '검색 조건과 맞는 항목이 없어요.' : remote ? '이 계정에서 조회할 수 있는 저장소가 없어요.' : '등록한 개발 프로젝트가 없어요.';
  region.replaceChildren(summary, entries.length ? table(remote, entries) : group('div', 'empty compact', node('p', '', empty)));
}

function render() {
  const remote = active === 'remote';
  tabs.forEach((tab, index) => {
    const selected = index === Number(remote);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  view.setAttribute('aria-labelledby', remote ? 'tab-remote' : 'tab-local');
  if (remote && !data.account) {
    view.replaceChildren(projectHeading('GitHub 프로젝트', 'GitHub 계정을 연결해 저장소 목록을 불러오세요.'),
      group('section', 'empty',
        group('span', 'empty-icon', icon('folder.svg')),
        node('h2', '', 'GitHub 계정 연결'), node('p', '', '접근 권한이 있는 공개·비공개 저장소를 볼 수 있어요.'),
        button('GitHub로 연결', connectDialog, 'primary')));
    return;
  }
  const region = node('section', 'results');
  const action = remote ? button('저장소 동기화', async () => { update(await api.sync()); notify('GitHub 목록을 동기화했어요.'); })
    : button('+ 프로젝트 등록', () => registerFlow(), 'primary');
  view.replaceChildren(projectHeading(remote ? 'GitHub 프로젝트' : '로컬 프로젝트',
    remote ? '@' + data.account.login + ' 계정의 저장소를 보고 로컬 폴더와 연결하세요.' : '이 PC에 등록한 개발 프로젝트를 열고 Git 상태를 확인하세요.', action),
    toolbar(remote, region), region);
  renderResults(region, remote);
}

function showDialog(title, description, content, actions) {
  const heading = node('h2', '', title);
  heading.id = 'dialog-title';
  const details = description ? [node('p', 'muted', description)] : [];
  modal.replaceChildren(heading, ...details, content, group('footer', '', ...actions));
  modal.prepend(notice);
  if (!modal.open) modal.showModal();
}

function close() { modal.close(); }
const cancel = () => button('취소', close);

function registerFlow(repo) {
  const description = repo ? repo.slug + '에 연결할 개발 프로젝트 폴더를 선택하세요.' : '개발 소스가 들어 있는 프로젝트 폴더를 선택하세요.';
  async function pick() {
    const result = await api.choose();
    if (!result) return;
    const candidates = repo ? result.candidates.filter(project => project.git.github.includes(repo.slug.toLowerCase())) : result.candidates;
    const path = group('div', 'selection', node('strong', '', '선택한 폴더'), node('span', 'path', result.folder));
    if (!candidates.length) {
      const mismatch = result.candidates.length > 0;
      showDialog('로컬 프로젝트 등록', description, group('div', 'dialog-stack', path,
        group('div', 'result warning', node('span', 'chip warning-chip', '등록할 수 없음'),
          node('strong', '', mismatch ? '일치하는 GitHub 원격을 찾지 못했어요' : '개발 소스를 찾지 못했어요'),
          node('p', '', mismatch ? '이 저장소를 복제한 로컬 폴더를 다시 선택하세요.' : '프로젝트 설정과 개발 소스가 있는 폴더를 다시 선택하세요.'))),
      [cancel(), button('다른 폴더 선택', pick, 'primary')]);
      return;
    }
    let selected = candidates[0];
    const choose = node('select');
    choose.setAttribute('aria-label', '감지한 하위 프로젝트');
    candidates.forEach(project => choose.append(new Option(project.name + ' · ' + project.path, project.path)));
    const resultCard = node('div', 'result');
    function renderCandidate() {
      resultCard.replaceChildren(node('span', 'chip', '개발 프로젝트 감지'), node('strong', '', selected.name),
        node('p', '', [selected.type, selected.version, selected.git.branch].filter(Boolean).join(' · ')),
        node('p', '', '확인한 항목 · ' + selected.evidence));
    }
    choose.addEventListener('change', () => { selected = candidates.find(item => item.path === choose.value); renderCandidate(); });
    renderCandidate();
    showDialog('로컬 프로젝트 등록', description, group('div', 'dialog-stack', path, ...(candidates.length > 1 ? [choose] : []), resultCard),
      [cancel(), button('다른 폴더 선택', pick), button('등록', async () => {
        update(await api.register(selected.path, repo?.slug));
        close();
        notify('프로젝트를 등록했어요.');
      }, 'primary')]);
  }

  showDialog('로컬 프로젝트 등록', description,
    group('div', 'empty compact', icon('folder.svg'), node('strong', '', '선택한 폴더가 없어요'), button('폴더 선택', pick)),
    [cancel()]);
}

function projectMenu(project) {
  const links = project.git.github.map(slug => button(slug + ' ↗', () => api.openRepo(slug), 'link'));
  showDialog(project.name, project.path,
    group('div', 'dialog-stack', button('폴더 열기', () => api.open(project.path, 'folder')),
      button('이 프로젝트 다시 확인', async () => { update(await api.refresh(project.path)); close(); }), ...links),
    [button('닫기', close), button('목록에서 제거', async () => {
      update(await api.remove(project.path));
      close();
    }, 'danger')]);
}

function showFolders(folders) {
  showDialog('로컬 폴더 열기', '연결된 폴더를 선택하세요.',
    group('div', 'dialog-stack', ...folders.map(project => button(project.path, () => api.open(project.path, 'folder')))), [cancel()]);
}

function accountMenu() {
  showDialog('GitHub 계정 관리', '@' + data.account.login,
    node('p', 'muted', '연결 해제 시 이 PC에 저장된 GitHub 인증 정보와 저장소 목록이 삭제됩니다.'),
    [cancel(), button('연결 해제', async () => { update(await api.disconnect()); close(); }, 'danger')]);
}

function field(label, type) {
  const input = node('input');
  input.type = type;
  input.autocomplete = 'off';
  return [group('label', 'field', node('span', '', label), input), input];
}

function connectDialog() {
  const [clientField, client] = field('GitHub App 클라이언트 ID', 'text');
  const [tokenField, token] = field('GitHub 개인 액세스 토큰', 'password');
  showDialog('GitHub 계정 연결', 'GitHub App으로 브라우저에서 로그인하거나 개인 액세스 토큰으로 연결하세요.',
    group('div', 'dialog-stack', clientField, button('브라우저 로그인 시작', async () => {
      const info = await api.startDevice(client.value.trim());
      if (!modal.open) { await api.cancelDevice(); return; }
      deviceDialog(info);
    }), tokenField, button('토큰으로 연결', async () => {
      const value = token.value.trim();
      token.value = '';
      update(await api.connect(value));
      close();
    }, 'primary')), [cancel()]);
}

function deviceDialog(info) {
  const session = ++deviceSession;
  showDialog('GitHub에서 승인', '브라우저에 아래 코드를 입력하고 앱 접근을 승인하세요.',
    group('div', 'result', node('code', 'device-code', info.code), button('GitHub 로그인 열기', () => api.openDevice())),
    [cancel()]);
  async function poll() {
    if (deviceSession !== session || !modal.open) return;
    try {
      const result = await api.pollDevice();
      if (deviceSession !== session || !modal.open) return;
      if (result.snapshot) { update(result.snapshot); close(); return; }
      setTimeout(poll, result.interval * 1000);
    } catch (error) {
      if (deviceSession !== session) return;
      notify(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true);
      connectDialog();
    }
  }
  setTimeout(poll, info.interval * 1000);
}

modal.addEventListener('close', () => {
  document.body.insertBefore(notice, modal);
  deviceSession++;
  void api.cancelDevice().catch(() => {});
});

function changeTab(index) {
  active = index ? 'remote' : 'local';
  query = '';
  filters = ['', ''];
  render();
  tabs[index].focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => changeTab(index));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    changeTab(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index);
  });
});

api.snapshot().then(update).catch(() => notify('저장한 프로젝트 목록을 불러오지 못했어요.', true));
