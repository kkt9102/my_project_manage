const fs = require('node:fs/promises');
const path = require('node:path');
const { inspect } = require('./projects.cjs');

function cell(value) {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  let text = String(value);
  // Quoting alone does not stop spreadsheet software from evaluating a cell.
  if (/^\s*[=+\-@＝＋－＠]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function csv(rows, sizeHeader) {
  const headers = ['프로젝트명', '언어 종류', '프로젝트 종류', '버전', sizeHeader, '저장소 주소'];
  return String.fromCodePoint(0xFEFF) + [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

async function folderBytes(folder) {
  let total = 0n;
  async function measure(current) {
    const directory = await fs.opendir(current);
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await measure(file);
      if (entry.isFile()) {
        const info = await fs.lstat(file, { bigint: true });
        if (info.isFile()) total += info.size;
      }
    }
  }
  try {
    if (!(await fs.lstat(folder)).isDirectory()) return null;
    await measure(folder);
    return total;
  } catch { return null; }
}

async function localCsv(projects) {
  const rows = [];
  for (const project of projects) {
    const previous = !Array.isArray(project.languages) || !Array.isArray(project.git.urls);
    const fresh = previous ? await inspect(project.path).catch(() => null) : null;
    const languages = fresh?.languages ?? project.languages ?? [];
    const urls = fresh?.git.urls ?? project.git.urls ?? project.git.github.map(slug => 'https://github.com/' + slug);
    rows.push([fresh?.name ?? project.name, languages.join(', '), fresh?.type ?? project.type, fresh ? fresh.version : project.version,
      await folderBytes(project.path), urls.join(' | ')]);
  }
  return csv(rows, '프로젝트 크기 (바이트)');
}

function githubCsv(repos, projects) {
  const rows = repos.map(repo => {
    const linked = projects.filter(project => !project.unavailable && project.git.github.includes(repo.slug.toLowerCase()));
    const versions = new Set(linked.map(project => project.version ?? null));
    const version = versions.size === 1 ? versions.values().next().value : null;
    const languages = repo.language ?? [...new Set(linked.flatMap(project => project.languages ?? []))].join(', ');
    const types = [...new Set(linked.map(project => project.type))].join(' / ');
    return [repo.name, languages, types, version, repo.sizeKb, 'https://github.com/' + repo.slug];
  });
  return csv(rows, '저장소 크기 (KB)');
}

module.exports = { localCsv, githubCsv, folderBytes };
