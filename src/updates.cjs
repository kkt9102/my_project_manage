const fs = require('node:fs/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const repo = 'kkt9102/my_project_manage';
const apiUrl = 'https://api.github.com/repos/' + repo + '/releases/latest';
const releaseBase = 'https://github.com/' + repo + '/releases/download/';
const assetHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const versionPattern = /^\d+\.\d+\.\d+$/;
const limit = 512 * 1024 * 1024;

function compareVersions(first, second) {
  const parts = version => version.split('.').map(Number);
  const a = parts(first);
  const b = parts(second);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function assetChoice(release, { version, revision, suffix }) {
  if (release?.draft || release?.prerelease || typeof release?.tag_name !== 'string' || !release.tag_name.startsWith('v')) return null;
  const latest = release.tag_name.slice(1);
  if (!versionPattern.test(latest) || !versionPattern.test(version) || compareVersions(latest, version) < 0) return null;
  const prefix = 'ProjectManage-' + latest + '-';
  const assets = (Array.isArray(release.assets) ? release.assets : []).flatMap(asset => {
    if (typeof asset.name !== 'string' || !asset.name.startsWith(prefix) || !asset.name.endsWith(suffix)) return [];
    const variant = asset.name.slice(prefix.length, -suffix.length);
    const build = variant.match(/^build\.([0-9a-f]{7,40})-$/)?.[1] ?? null;
    if (variant && !build) return [];
    const url = releaseBase + release.tag_name + '/' + asset.name;
    const digest = typeof asset.digest === 'string' && asset.digest.match(/^sha256:([0-9a-f]{64})$/)?.[1];
    const uploaded = Date.parse(asset.created_at);
    if (asset.state !== 'uploaded' || asset.browser_download_url !== url || !digest ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > limit || !Number.isFinite(uploaded)) return [];
    return [{ name: asset.name, version: latest, revision: build, uploaded, url, digest, size: asset.size }];
  });
  assets.sort((a, b) => b.uploaded - a.uploaded);
  if (!assets.length) return null;
  if (compareVersions(latest, version) > 0) return assets[0];

  const installed = assets.find(asset => asset.revision === revision);
  if (!installed) return null;
  return assets[0].uploaded > installed.uploaded ? assets[0] : null;
}

async function releaseUpdate(installed, request = fetch) {
  try {
    const response = await request(apiUrl, {
      redirect: 'error', headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Error();
    return assetChoice(await response.json(), installed);
  } catch {
    throw Error('GitHub에서 업데이트 정보를 가져오지 못했어요. 잠시 후 다시 확인해 주세요.');
  }
}

async function assetResponse(url, request, signal) {
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await request(url, { redirect: 'manual', signal });
    if (response.ok && response.body) return response;
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) break;
    const target = new URL(location, url);
    if (target.protocol !== 'https:' || !assetHosts.has(target.hostname) || target.username || target.password || target.port) break;
    if (response.body) await response.body.cancel();
    url = target.href;
  }
  throw Error('GitHub에서 업데이트 파일을 받지 못했어요.');
}

async function markDownload(file, url) {
  if (process.platform === 'win32') {
    await fs.writeFile(file + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=' + url + '\r\n');
  } else if (process.platform === 'darwin') {
    const seconds = Math.floor(Date.now() / 1000).toString(16);
    await exec('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;' + seconds + ';ProjectManage;', file], { timeout: 5000 });
  }
}

async function downloadUpdate(asset, folder, request = fetch) {
  const directory = await fs.mkdtemp(path.join(folder, 'ProjectManage-Update-'));
  const destination = path.join(directory, asset.name);
  const signal = AbortSignal.timeout(10 * 60 * 1000);
  const hash = createHash('sha256');
  let size = 0;
  const inspect = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > asset.size) return callback(Error('크기 불일치'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    const response = await assetResponse(asset.url, request, signal);
    await pipeline(response.body, inspect, createWriteStream(destination + '.part', { flags: 'wx', mode: 0o600 }), { signal });
    if (size !== asset.size || hash.digest('hex') !== asset.digest) throw Error('무결성 불일치');
    await fs.rename(destination + '.part', destination);
    await markDownload(destination, asset.url);
    return destination;
  } catch {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw Error('업데이트 파일을 받거나 검증하지 못했어요. 다시 시도해 주세요.');
  }
}

async function verifyArchive(asset, file) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size !== asset.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === asset.digest;
  } catch { return false; }
}

module.exports = { assetChoice, releaseUpdate, downloadUpdate, verifyArchive };
