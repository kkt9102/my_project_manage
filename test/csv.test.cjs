const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { localCsv, githubCsv, folderBytes } = require('../src/csv.cjs');
const { remoteAddress } = require('../src/projects.cjs');

test('로컬 CSV는 Excel용 BOM과 이스케이프, 파일 합계, 저장소 주소를 저장한다', async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'projectmanage-csv-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  await fs.mkdir(project);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(project, 'code.py'), '123456');
  await fs.writeFile(path.join(outside, 'extra.txt'), 'outside');
  await fs.symlink(outside, path.join(project, 'linked-directory'), process.platform === 'win' ? 'junction' : 'dir');
  assert.equal(await folderBytes(project), 6n);
  assert.equal(await folderBytes(path.join(root, 'missing')), null);

  const result = await localCsv([{
    path: project, name: '=한글,"이름"', type: 'FastAPI', version: '1.2.3', languages: ['Python', 'JavaScript'],
    git: { urls: ['https://github.com/example/app'], github: ['example/app'] },
  }]);
  assert.equal(result.codePointAt(0), 0xFEFF);
  assert.match(result, /"프로젝트 크기 \(바이트\)","저장소 주소"\r\n/);
  assert.equal(result.split('\r\n')[1], "\"'=한글,\"\"이름\"\"\",\"Python, JavaScript\",\"FastAPI\",\"1.2.3\",6,\"https://github.com/example/app\"");
});

test('GitHub CSV의 크기는 KB이고 연결된 프로젝트가 있으면 버전을 표시한다', () => {
  const result = githubCsv([
    { name: 'linked', slug: 'Example/Linked', language: 'TypeScript', sizeKb: 1024 },
    { name: 'only-remote', slug: 'Example/Remote', language: null, sizeKb: 0 },
  ], [{ version: '0.1.0', type: 'NestJS', git: { github: ['example/linked'] } }]);
  assert.match(result, /"저장소 크기 \(KB\)"/);
  assert.match(result, /"linked","TypeScript","NestJS","0\.1\.0",1024,"https:\/\/github\.com\/Example\/Linked"/);
  assert.match(result, /"only-remote","","",,0,"https:\/\/github\.com\/Example\/Remote"/);
});

test('원격 주소에 들어 있는 사용자 정보, 비밀번호, 쿼리, 로컬 경로를 내보내지 않는다', () => {
  assert.equal(remoteAddress('https://example:placeholder@git.example.com/team/repo.git?key=placeholder#hash'), 'https://git.example.com/team/repo.git');
  assert.equal(remoteAddress('git@github.com:Example/Project.git'), 'https://github.com/example/project');
  assert.equal(remoteAddress('git@git.example.com:team/repo.git'), 'ssh://git.example.com/team/repo.git');
  assert.equal(remoteAddress('file:///home/user/private.git'), null);
});
