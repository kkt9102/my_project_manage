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

test('NestJS 의존성이나 CLI 설정으로 Node.js 프로젝트의 종류를 구분한다', async t => {
  const dir = await fixture(t);
  const manifest = path.join(dir, 'package.json');
  await fs.writeFile(path.join(dir, 'main.ts'), '');
  await fs.writeFile(manifest, '{"name":"api","version":"0.4.2","dependencies":{"@nestjs/core":"^11.0.0"}}');
  const { candidates: [nest] } = await discover(dir);
  assert.equal(nest.type, 'NestJS');
  assert.equal(nest.name, 'api');
  assert.equal(nest.version, '0.4.2');
  await fs.writeFile(manifest, '{"name":"api"}');
  assert.equal((await discover(dir)).candidates[0].type, 'Node.js');
  await fs.writeFile(path.join(dir, 'nest-cli.json'), '{}');
  assert.equal((await discover(dir)).candidates[0].type, 'NestJS');
});

test('package.json 없이 Ruby 프로젝트와 gem 버전을 읽는다', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'lib', 'sample'), { recursive: true });
  await fs.writeFile(path.join(dir, 'sample.gemspec'), 'spec.name = "sample-gem"\nspec.version = Sample::VERSION\n');
  await fs.writeFile(path.join(dir, 'lib', 'sample', 'version.rb'), 'module Sample\n  VERSION = "1.3.2"\nend\n');
  const { candidates: [gem] } = await discover(dir);
  assert.equal(gem.type, 'Ruby');
  assert.equal(gem.name, 'sample-gem');
  assert.equal(gem.version, '1.3.2');
});

test('구형 Rails 레이아웃과 단독 Ruby 소스를 감지하고 설정 파일만 있는 폴더는 제외한다', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'gems.rb'), 'gem "rails"');
  assert.deepEqual((await discover(dir)).candidates, []);
  await fs.writeFile(path.join(dir, 'main.rb'), 'puts "hello"');
  assert.equal((await discover(dir)).candidates[0].type, 'Ruby');
  await fs.mkdir(path.join(dir, 'app', 'models'), { recursive: true });
  await fs.mkdir(path.join(dir, 'config'));
  await fs.writeFile(path.join(dir, 'app', 'models', 'item.rb'), 'class Item; end');
  await fs.writeFile(path.join(dir, 'config', 'boot.rb'), '');
  await fs.writeFile(path.join(dir, 'config', 'environment.rb'), 'RAILS_GEM_VERSION = "2.3.18"');
  await fs.writeFile(path.join(dir, 'package.json'), '{"name":"assets"}');
  await fs.writeFile(path.join(dir, 'assets.js'), '');
  const { candidates: [rails] } = await discover(dir);
  assert.equal(rails.type, 'Ruby on Rails');
  assert.equal(rails.version, null);
});
