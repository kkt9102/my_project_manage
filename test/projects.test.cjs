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

test('CMake 프로젝트에서 C/C++와 이름·버전을 읽고 헤더나 빌드 산출물만 있으면 등록하지 않는다', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'CMakeLists.txt'), '# project(fake VERSION 9.0)\nproject("Native Tool" VERSION 1.2.3 LANGUAGES C CXX)\n');
  await fs.writeFile(path.join(dir, 'tool.h'), '');
  await fs.mkdir(path.join(dir, 'build'));
  await fs.writeFile(path.join(dir, 'build', 'build.cpp'), '');
  assert.deepEqual((await discover(dir)).candidates, []);
  await fs.writeFile(path.join(dir, 'tool.c'), 'int main(void) { return 0; }');
  const { candidates: [c] } = await discover(dir);
  assert.equal(c.type, 'C');
  assert.equal(c.name, 'Native Tool');
  assert.equal(c.version, '1.2.3');
  await fs.writeFile(path.join(dir, 'helper.cpp'), '');
  assert.equal((await discover(dir)).candidates[0].type, 'C / C++');
});

test('C# 프로젝트와 별도 빌드 설정이 없는 Java 프로젝트를 구분한다', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'ConsoleTool.csproj'), '<Project><PropertyGroup><AssemblyName>Tool</AssemblyName><Version>0.8.0</Version></PropertyGroup></Project>');
  await fs.writeFile(path.join(dir, 'Program.cs'), '');
  const { candidates: [dotnet] } = await discover(dir);
  assert.equal(dotnet.type, 'C# · .NET');
  assert.equal(dotnet.name, 'Tool');
  assert.equal(dotnet.version, '0.8.0');
  await fs.rename(path.join(dir, 'ConsoleTool.csproj'), path.join(dir, 'backup.txt'));
  await fs.writeFile(path.join(dir, 'Main.java'), '');
  assert.equal((await discover(dir)).candidates[0].type, 'Java');
});

test('Maven과 Gradle의 Spring Boot를 구분하고 앱 버전을 읽는다', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'App.java'), '');
  const pom = path.join(dir, 'pom.xml');
  await fs.writeFile(pom, '<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.5.0</version></parent><artifactId>app</artifactId><version>1.0.0</version></project>');
  const { candidates: [maven] } = await discover(dir);
  assert.equal(maven.type, 'Spring Boot · Maven');
  assert.equal(maven.name, 'app');
  assert.equal(maven.version, '1.0.0');
  await fs.rename(pom, path.join(dir, 'backup.xml'));
  await fs.writeFile(path.join(dir, 'settings.gradle.kts'), 'rootProject.name = "app"');
  await fs.writeFile(path.join(dir, 'build.gradle.kts'), 'plugins { id("org.springframework.boot") version "3.5.0" }\nversion = "1.0.0"');
  const { candidates: [gradle] } = await discover(dir);
  assert.equal(gradle.type, 'Spring Boot · Gradle');
  assert.equal(gradle.version, '1.0.0');
});

test('Vue 컴포넌트와 Django 기본 구조를 package.json 없이 감지한다', async t => {
  const dir = await fixture(t);
  const django = path.join(dir, 'django-app');
  const vue = path.join(dir, 'vue-app');
  await fs.mkdir(path.join(django, 'config'), { recursive: true });
  await fs.mkdir(vue);
  await fs.writeFile(path.join(django, 'manage.py'), 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")\nfrom django.core.management import execute_from_command_line');
  await fs.writeFile(path.join(django, 'config', 'settings.py'), '');
  await fs.writeFile(path.join(vue, 'index.html'), '');
  await fs.writeFile(path.join(vue, 'App.vue'), '<template><main>Hello</main></template>');
  assert.equal((await discover(django)).candidates[0].type, 'Django');
  assert.equal((await discover(vue)).candidates[0].type, 'Vue');
});
