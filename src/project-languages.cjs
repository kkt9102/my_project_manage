const { extensions } = require('./languages.json');

const overrides = {
  '.C': 'C++', '.php': 'PHP', '.ex': 'Elixir', '.r': 'R', '.R': 'R',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.cs': 'C#', '.fs': 'F#', '.vb': 'Visual Basic .NET',
  '.sol': 'Solidity', '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro',
  '.css': 'CSS', '.html': 'HTML', '.htm': 'HTML',
};

function languageOf(file) {
  const name = file.slice(file.lastIndexOf('/') + 1);
  for (let dot = name.indexOf('.'); dot > 0; dot = name.indexOf('.', dot + 1)) {
    const suffix = name.slice(dot);
    const language = overrides[suffix] ?? overrides[suffix.toLowerCase()] ?? extensions[suffix] ?? extensions[suffix.toLowerCase()];
    if (language) return language;
  }
  return null;
}

const genericConfig = /(?:^|\/)(?:(?:setup|install|uninstall|configure|build|webpack|gulpfile|gruntfile|gems|manage|settings|project|mix|rebar\.config)\.[^/]+|[^/]+\.(?:(?:config|min|bundle|generated)\.[^.]+|nimble|rockspec|d\.ts))$/i;
const genericEntry = /^(?:[^/]+|(?:src|source|sources|lib|app|cmd|internal|scripts|include)\/.+)$/i;
const nonEntryLanguages = new Set(['HTML', 'CSS', 'Vue', 'Svelte', 'Astro']);

function languagesOf(files) {
  const counts = new Map();
  for (const file of files) {
    if (genericConfig.test(file)) continue;
    const language = languageOf(file);
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
}

const rules = [
  ['PHP', 'composer.json', 'json'],
  ['Dart', 'pubspec.yaml', 'colon'],
  ['Elixir', 'mix.exs', 'elixir'],
  ['Erlang', 'rebar.config', null],
  ['Haskell', /\.cabal$/i, 'colon'],
  ['Haskell', 'stack.yaml', null],
  ['Zig', 'build.zig.zon', 'zig'],
  ['Nim', /\.nimble$/i, 'nim'],
  ['Crystal', 'shard.yml', 'colon'],
  ['Julia', 'Project.toml', 'assign'],
  ['D', 'dub.json', 'json'],
  ['Elm', 'elm.json', 'json'],
  ['OCaml', 'dune-project', 'dune'],
  ['Clojure', 'project.clj', 'clojure'],
  ['Clojure', 'deps.edn', null],
  ['R', 'DESCRIPTION', 'r'],
  ['PureScript', 'spago.yaml', 'colon'],
  ['Typst', 'typst.toml', 'assign'],
];

const value = String.raw`(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([\w.+-]+))`;
function field(text, key, separator) {
  const match = text.match(new RegExp('^[ \\t]*' + key + '[ \\t]*' + separator + '[ \\t]*' + value + '[ \\t]*(?:#.*)?$', 'mi'));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function metadata(text, format) {
  if (format === 'json') {
    try {
      const entry = JSON.parse(text);
      return { name: entry?.name, version: entry?.version, dependencies: entry?.require };
    } catch { return {}; }
  }
  if (format === 'clojure') {
    const match = text.match(/^\s*\(defproject\s+([\w./-]+)\s+"([^"]+)"/m);
    return { name: match?.[1], version: match?.[2] };
  }
  if (format === 'elixir') {
    return { name: text.match(/\bapp:\s*:([a-z][\w]*)/m)?.[1], version: text.match(/\bversion:\s*"([^"]+)"/m)?.[1] };
  }
  if (format === 'zig') {
    return { name: text.match(/\.name\s*=\s*(?:"([^"]+)"|\.([\w]+))/)?.slice(1).find(Boolean),
      version: text.match(/\.version\s*=\s*"([^"]+)"/)?.[1] };
  }
  if (format === 'dune') {
    return { name: text.match(/^\s*\(name\s+([\w.-]+)\)/m)?.[1], version: text.match(/^\s*\(version\s+([\w.-]+)\)/m)?.[1] };
  }
  if (!format) return {};
  const separator = ['colon', 'r'].includes(format) ? ':' : '=';
  const root = format === 'assign' ? text.split(/^\s*\[/m)[0] : text;
  return { name: field(root, format === 'r' ? 'Package' : 'name', separator), version: field(root, 'version', separator) };
}

async function additionalProject(names, files, languages, read) {
  const sourceFiles = files.filter(file => !genericConfig.test(file));
  for (const [language, marker, format] of rules) {
    if (!languages.includes(language)) continue;
    const manifest = typeof marker === 'string' ? (names.has(marker) && marker) : [...names].find(name => marker.test(name));
    if (!manifest || !sourceFiles.some(file => file !== manifest && languageOf(file) === language)) continue;
    const content = await read(manifest);
    const { name, version, dependencies } = metadata(content, format);
    const type = language === 'Dart' && /^[ \t]+sdk:\s*flutter\s*$/m.test(content) ? 'Flutter'
      : dependencies?.['laravel/framework'] ? 'Laravel'
      : dependencies?.['symfony/framework-bundle'] ? 'Symfony' : language;
    return { type, language, name, version, evidence: manifest + ' · ' + language + ' 소스', manifest };
  }
  const candidates = sourceFiles.filter(file => genericEntry.test(file));
  const language = languagesOf(candidates).find(item => !nonEntryLanguages.has(item));
  return language ? { type: language, language, evidence: candidates.find(file => languageOf(file) === language) } : null;
}

module.exports = { languagesOf, additionalProject };
