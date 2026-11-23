const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const ignored = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'coverage', 'bin', 'obj', 'Pods']);
const extensions = {
  web: /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i,
  rust: /\.rs$/i,
  jvm: /\.(?:java|kt|scala|groovy)$/i,
  swift: /\.swift$/i,
  dotnet: /\.(?:cs|fs|vb)$/i,
  python: /\.py$/i,
  go: /\.go$/i,
};

async function entries(dir) {
  return (await fs.readdir(dir, { withFileTypes: true })).slice(0, 2000);
}

async function read(dir, filename) {
  const file = path.join(dir, filename);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return '';
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function sources(dir, rootEntries) {
  const files = [];
  let budget = 90;
  async function walk(current, list, depth) {
    for (const entry of list) {
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue;
      if (entry.isFile()) files.push(path.relative(dir, path.join(current, entry.name)));
      if (entry.isDirectory() && depth > 0 && budget > 0) {
        budget--;
        const next = path.join(current, entry.name);
        await walk(next, await entries(next).catch(() => []), depth - 1);
      }
    }
  }
  await walk(dir, rootEntries, 5);
  return files;
}

function str(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

function gitHubKey(url) {
  const value = url.trim();
  const ssh = value.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  let slug = ssh?.[1];
  if (!slug) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname !== 'github.com' || !['https:', 'http:', 'ssh:'].includes(parsed.protocol)) return null;
      slug = parsed.pathname.replace(/^\/|\/$/g, '');
    } catch { return null; }
  }
  const key = slug.replace(/\.git$/i, '');
  return /^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(key) ? key.toLowerCase() : null;
}

async function git(dir) {
  const run = async (...args) => (await exec('git', ['-C', dir, ...args], { timeout: 2500, windowsHide: true, maxBuffer: 128 * 1024 })).stdout.trim();
  try {
    const root = await run('rev-parse', '--show-toplevel');
    const [branch, remotes] = await Promise.all([
      run('symbolic-ref', '--short', 'HEAD').catch(() => '분리된 HEAD'),
      run('remote', '-v').catch(() => ''),
    ]);
    const urls = remotes.split('\n').map(line => line.match(/^\S+\s+(.+?)\s+\((?:fetch|push)\)$/)?.[1]).filter(Boolean);
    return { state: 'git', root, branch, remote: urls.length > 0, github: [...new Set(urls.map(gitHubKey).filter(Boolean))] };
  } catch (error) {
    return { state: error.code === 'ENOENT' ? 'unavailable' : 'none', root: null, branch: null, remote: false, github: [] };
  }
}

async function inspect(dir) {
  const folder = await fs.realpath(dir);
  const list = await entries(folder);
  const names = new Set(list.filter(item => item.isFile()).map(item => item.name));
  const files = await sources(folder, list);
  const has = extension => files.some(file => extension.test(file) && !/(?:^|[\\/])(?:[^\\/]+\.(?:config|min|bundle|generated)\.[^.]+|[^\\/]+\.d\.ts)$/i.test(file));
  const make = (type, name, version, evidence) => ({ type, name: str(name) ?? path.basename(folder), version: str(version), evidence });
  const item = async () => {
    if (names.has('package.json') && has(extensions.web)) {
      try {
        const data = JSON.parse(await read(folder, 'package.json'));
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const deps = { ...data.dependencies, ...data.devDependencies };
          const type = deps.next ? 'Next.js' : deps['react-native'] ? 'React Native' : deps.vue ? 'Vue' : deps.react ? 'React' : deps.electron ? 'Electron' : 'Node.js';
          return make(type, data.name, data.version, 'package.json · JS/TS 소스');
        }
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    if (names.has('Cargo.toml') && has(extensions.rust)) {
      const manifest = await read(folder, 'Cargo.toml');
      const section = manifest.split(/^[\t ]*\[package\][\t ]*(?:#.*)?\r?$/m)[1]?.split(/^[\t ]*\[/m)[0] ?? '';
      const field = key => section.match(new RegExp('^\\s*' + key + '\\s*=\\s*["\\x27]([^"\\x27]+)', 'm'))?.[1];
      return make('Rust', field('name'), field('version'), 'Cargo.toml · Rust 소스');
    }
    if (names.has('pom.xml') && has(extensions.jvm)) {
      const pom = (await read(folder, 'pom.xml')).replace(/<!--[\s\S]*?-->|<(parent|dependencies|dependencyManagement|build|profiles|properties|reporting|pluginRepositories|repositories|distributionManagement)\b[^>]*>[\s\S]*?<\/\1>/g, '');
      const tag = key => pom.match(new RegExp('<' + key + '>\\s*([^<$]+?)\\s*</' + key + '>'))?.[1];
      return make('Java · Maven', tag('artifactId'), tag('version'), 'pom.xml · JVM 소스');
    }
    const gradle = ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'settings.gradle'].find(name => names.has(name));
    if (gradle && has(extensions.jvm)) {
      const settings = await read(folder, names.has('settings.gradle.kts') ? 'settings.gradle.kts' : 'settings.gradle');
      const build = await read(folder, gradle);
      return make(/com\.android\.(?:application|library)/.test(build) || files.some(f => f.endsWith('AndroidManifest.xml')) ? 'Android · Gradle' : 'Java/Kotlin · Gradle',
        settings.match(/rootProject\.name\s*=\s*['"]([^'"]+)/)?.[1], build.match(/^\s*version\s*=\s*['"]([^'"]+)/m)?.[1], gradle + ' · JVM 소스');
    }
    if ((names.has('Package.swift') || list.some(entry => entry.isDirectory() && entry.name.endsWith('.xcodeproj'))) && has(extensions.swift)) {
      const swift = await read(folder, 'Package.swift');
      return make('Swift', swift.match(/\bname:\s*"([^"]+)"/)?.[1], null, 'Swift 설정 · Swift 소스');
    }
    const dotnet = [...names].find(name => /\.(?:cs|fs|vb)proj$/i.test(name));
    if (dotnet && has(extensions.dotnet)) {
      const xml = await read(folder, dotnet);
      return make('.NET', path.basename(dotnet, path.extname(dotnet)), xml.match(/<Version>([^<$]+)<\/Version>/)?.[1], dotnet + ' · .NET 소스');
    }
    if (names.has('go.mod') && has(extensions.go)) {
      const module = (await read(folder, 'go.mod')).match(/^module\s+(\S+)/m)?.[1];
      return make('Go', module?.split('/').at(-1), null, 'go.mod · Go 소스');
    }
    const python = ['pyproject.toml', 'requirements.txt', 'setup.py'].find(name => names.has(name));
    if (python && has(extensions.python)) {
      const manifest = await read(folder, python);
      const project = manifest.split(/^\s*\[(?:project|tool\.poetry)\]\s*$/m)[1]?.split(/^\s*\[/m)[0] ?? '';
      return make('Python', project.match(/^\s*name\s*=\s*["']([^"']+)/m)?.[1], project.match(/^\s*version\s*=\s*["']([^"']+)/m)?.[1], python + ' · Python 소스');
    }
    if (names.has('index.html') && (has(extensions.web) || files.some(file => /\.css$/i.test(file)))) {
      return make('정적 웹', null, null, 'index.html · CSS/JS 소스');
    }
    return null;
  };
  const detected = await item();
  return detected ? { ...detected, path: folder, git: await git(folder), checkedAt: new Date().toISOString() } : null;
}

async function discover(dir) {
  const folder = await fs.realpath(dir);
  const root = await inspect(folder);
  if (root) return { folder, candidates: [root] };
  const children = (await entries(folder)).filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name)).slice(0, 30);
  const candidates = [];
  for (const child of children) {
    const result = await inspect(path.join(folder, child.name)).catch(() => null);
    if (result) candidates.push(result);
  }
  return { folder, candidates };
}

module.exports = { discover, inspect, gitHubKey };
