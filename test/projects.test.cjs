const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { discover, gitHubKey } = require('../src/projects.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'projectmanage-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('소스가 없는 설치 폴더를 제외하고 실제 하위 프로젝트의 버전을 읽는다', async t => {
  const parent = await fixture(t);
  const install = path.join(parent, 'installer');
  const rust = path.join(parent, 'rust');
  await fs.mkdir(path.join(rust, 'src'), { recursive: true });
  await fs.mkdir(path.join(install, 'dist'), { recursive: true });
  await fs.writeFile(path.join(install, 'package.json'), '{"name":"bundle"}');
  await fs.writeFile(path.join(install, 'dist', 'app.js'), '');
  await fs.writeFile(path.join(install, 'setup.exe'), '');
  await fs.writeFile(path.join(rust, 'Cargo.toml'), '[package]\nname = "rust-tool"\nversion = "1.2.3"\n[dependencies]\n');
  await fs.writeFile(path.join(rust, 'src', 'main.rs'), 'fn main() {}');
  const { candidates } = await discover(parent);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, 'rust-tool');
  assert.equal(candidates[0].version, '1.2.3');
});

test('Git 브랜치와 GitHub 원격을 읽고 SSH와 HTTPS 주소를 같은 키로 정규화한다', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'package.json'), '{"name":"web-app","version":"0.1.0","dependencies":{"next":"1"}}');
  await fs.writeFile(path.join(dir, 'index.tsx'), '');
  execFileSync('git', ['init', '-b', 'main', dir], { stdio:'ignore' });
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:Example/Web-App.git']);
  const { candidates: [project] } = await discover(dir);
  assert.equal(project.type, 'Next.js');
  assert.equal(project.git.branch, 'main');
  assert.deepEqual(project.git.github, [gitHubKey('https://github.com/example/web-app')]);
  assert.equal(gitHubKey('https://github.com.example.com/example/web-app'), null);
});
