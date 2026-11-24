const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { assetChoice, downloadUpdate, verifyArchive } = require('../src/updates.cjs');

const origin = 'https://github.com/kkt9102/my_project_manage/releases/download/';
const payload = Buffer.from('fixture update archive');
const sha = createHash('sha256').update(payload).digest('hex');
const asset = (version, build, date, suffix = 'win-x64.exe') => {
  const name = 'ProjectManage-' + version + '-' + (build ? 'build.' + build + '-' : '') + suffix;
  return { name, browser_download_url: origin + 'v' + version + '/' + name, state: 'uploaded', size: payload.length,
    digest: 'sha256:' + sha, created_at: date };
};

test('업데이트는 현재 운영체제와 배포 방식의 새 버전 또는 같은 버전의 새 빌드를 고른다', () => {
  const oldest = '2026-11-23T06:00:00Z';
  const newer = '2026-11-24T06:10:00Z';
  const current = { version:'0.1.2', revision:'aaa1111', suffix:'win-x64.exe' };
  const release = { tag_name:'v0.1.2', assets:[
    asset('0.1.2', null, oldest),
    asset('0.1.2', 'aaa1111', newer),
    asset('0.1.2', 'bbb2222', '2026-11-24T06:20:00Z'),
    asset('0.1.2', 'ccc3333', '2026-11-24T06:30:00Z', 'win-x64.zip'),
    asset('0.1.2', 'ddd4444', '2026-11-24T06:40:00Z', 'mac-arm64.dmg'),
  ] };
  assert.equal(assetChoice(release, current).revision, 'bbb2222');
  assert.equal(assetChoice(release, { ...current, revision: 'bbb2222' }), null);
  assert.equal(assetChoice(release, { ...current, revision: 'eee5555' }), null);
  assert.equal(assetChoice(release, { ...current, version:'0.1.3' }), null);
  assert.equal(assetChoice({ tag_name:'v0.1.10', assets:[asset('0.1.10', null, newer)] }, current).version, '0.1.10');
  assert.equal(assetChoice({ ...release, prerelease: true }, current), null);
});

test('다른 저장소 주소 또는 확인 가능한 SHA-256이 없는 파일을 선택하지 않는다', () => {
  const valid = asset('0.1.3', null, '2026-11-24T06:00:00Z');
  const release = { tag_name:'v0.1.3', assets:[
    { ...valid, browser_download_url:'https://github.com/another/repository/releases/download/v0.1.3/' + valid.name },
    { ...valid, digest:null },
  ] };
  assert.equal(assetChoice(release, { version:'0.1.2', revision:null, suffix:'win-x64.exe' }), null);
});

test('업데이트 파일을 저장·검증하고 무결성이 다르거나 허용되지 않은 리디렉션은 제외한다', async t => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'projectmanage-updates-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const release = { tag_name:'v0.1.3', assets:[asset('0.1.3', null, '2026-11-24T06:00:00Z')] };
  const update = assetChoice(release, { version:'0.1.2', revision:null, suffix:'win-x64.exe' });
  const cdn = 'https://release-assets.githubusercontent.com/fixture';
  const request = async url => url === update.url ? Response.redirect(cdn) : new Response(payload);
  const file = await downloadUpdate(update, directory, request);
  assert.equal(await verifyArchive(update, file), true);
  await fs.writeFile(file, Buffer.alloc(payload.length));
  assert.equal(await verifyArchive(update, file), false);

  await assert.rejects(downloadUpdate(update, directory, async () => new Response(Buffer.alloc(payload.length))), /검증/);
  await assert.rejects(downloadUpdate(update, directory, async () => Response.redirect('https://example.com/file')), /검증/);
  assert.equal((await fs.readdir(directory)).length, 1);
});
