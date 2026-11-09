import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { compareVersions } from './version.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(withGit = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-version-'));
  directories.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const node = (script: string, ...args: string[]) => spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], { cwd: dir, encoding: 'utf8' });
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const write = (file: string, value: unknown) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, '.githooks'));
  for (const file of ['scripts/version.ts', 'scripts/install-hooks.ts', '.githooks/pre-commit']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  fs.chmodSync(path.join(dir, '.githooks/pre-commit'), 0o755);
  write('package.json', { name: 'test', type: 'module', version: '0.2.0', scripts: { unchanged: 'yes' } });
  write('package-lock.json', { name: 'test', version: '0.2.0', lockfileVersion: 3, packages: { '': { version: '0.2.0' }, dependency: { version: '5.0.0' } } });
  if (withGit) {
    git('init', '--quiet');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', '.githooks');
    git('add', '.');
    git('commit', '--quiet', '-m', 'initial');
  }
  return { dir, git, node, read, write };
}

test('installed hook bumps every changed commit, preserving manual version increases', () => {
  const f = fixture();
  assert.equal(f.node('install-hooks.ts').status, 0);
  for (const version of ['0.2.1', '0.2.2']) {
    fs.writeFileSync(path.join(f.dir, 'change.txt'), version);
    f.git('add', 'change.txt');
    f.git('commit', '--quiet', '-m', version);
    for (const file of ['package.json', 'package-lock.json']) assert.equal(JSON.parse(f.git('show', `HEAD:${file}`)).version, version);
    assert.equal(f.read('package-lock.json').packages[''].version, version);
    assert.equal(f.read('package-lock.json').packages.dependency.version, '5.0.0');
    assert.equal(f.read('package.json').scripts.unchanged, 'yes');
    assert.equal(f.git('status', '--porcelain'), '');
  }
  const pkg = f.read('package.json'), lock = f.read('package-lock.json');
  pkg.version = lock.version = lock.packages[''].version = '0.3.0';
  f.write('package.json', pkg); f.write('package-lock.json', lock);
  f.git('add', '.'); f.git('commit', '--quiet', '-m', 'minor release');
  assert.equal(f.read('package.json').version, '0.3.0');
  assert.equal(f.node('version.ts', 'commit').status, 0);
  assert.equal(f.read('package.json').version, '0.3.0');
});

test('hook refuses partial manifest staging without staging or overwriting other work', () => {
  const f = fixture();
  const pkg = f.read('package.json');
  pkg.scripts.staged = 'keep'; f.write('package.json', pkg); f.git('add', 'package.json');
  pkg.scripts.unstaged = 'keep too'; f.write('package.json', pkg);
  const before = fs.readFileSync(path.join(f.dir, 'package.json'), 'utf8');
  assert.notEqual(f.node('version.ts', 'commit').status, 0);
  assert.equal(fs.readFileSync(path.join(f.dir, 'package.json'), 'utf8'), before);
  assert.equal(JSON.parse(f.git('show', ':package.json')).scripts.unstaged, undefined);
  assert.equal(f.read('package-lock.json').version, '0.2.0');
});

test('CI rejects unchanged, lower and inconsistent versions and accepts patch or minor bumps', () => {
  const f = fixture();
  const base = f.git('rev-parse', 'HEAD');
  assert.notEqual(f.node('version.ts', 'check', base).status, 0);
  assert.equal(f.node('version.ts', 'bump').status, 0);
  assert.equal(f.node('version.ts', 'check', base).status, 0);
  const pkg = f.read('package.json');
  pkg.version = '0.3.0'; f.write('package.json', pkg);
  assert.notEqual(f.node('version.ts', 'check', base).status, 0);
  const lock = f.read('package-lock.json');
  lock.version = lock.packages[''].version = '0.3.0'; f.write('package-lock.json', lock);
  assert.equal(f.node('version.ts', 'check', base).status, 0);
  pkg.version = lock.version = lock.packages[''].version = '0.1.9';
  f.write('package.json', pkg); f.write('package-lock.json', lock); f.git('add', '.');
  assert.notEqual(f.node('version.ts', 'commit').status, 0);
  assert.notEqual(f.node('version.ts', 'check', base).status, 0);
  assert.notEqual(f.node('version.ts', 'check', 'missing-commit').status, 0);
});

test('Docker without Git metadata needs no hook installation; existing hooks are preserved', () => {
  const docker = fixture(false);
  assert.equal(docker.node('install-hooks.ts').status, 0);
  assert.equal(fs.existsSync(path.join(docker.dir, '.git')), false);
  assert.equal(docker.node('version.ts', 'check', '0000000').status, 0);
  const custom = fixture();
  custom.git('config', 'core.hooksPath', 'custom-hooks');
  assert.equal(custom.node('install-hooks.ts').status, 0);
  assert.equal(custom.git('config', '--get', 'core.hooksPath'), 'custom-hooks');
});

test('versions compare numerically and unsupported version formats are rejected', () => {
  assert.ok(compareVersions('0.2.10', '0.2.9') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('0.2.1', '0.2.1'), 0);
  for (const invalid of ['v1.0.0', '1.0', '01.0.0', '1.0.0-beta', null]) assert.throws(() => compareVersions(invalid, '0.2.0'));
});
