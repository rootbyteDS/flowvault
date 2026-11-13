import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

function browserBinary() {
  if (process.env.DASHBOARD_BROWSER_BIN) return process.env.DASHBOARD_BROWSER_BIN;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (!fs.existsSync(cache)) return undefined;
  for (const folder of fs.readdirSync(cache).filter((s) => s.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const binary = path.join(cache, folder, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (fs.existsSync(binary)) return binary;
  }
}
const binary = browserBinary();

test('real dashboard drag into free space, exact preview, save/reload, touch and cancel', {
  skip: binary ? false : 'Set DASHBOARD_BROWSER_BIN to an installed Chromium/headless-shell executable', timeout: 60000,
}, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-browser-'));
  const browser = spawn(binary!, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
    `--user-data-dir=${path.join(directory, 'profile')}`, '--allow-file-access-from-files'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let sequence = 0, buffer = '';
  const exceptions: string[] = [];
  (browser.stdio[4] as Readable).on('data', (chunk) => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const packet = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (packet.method === 'Runtime.exceptionThrown') exceptions.push(JSON.stringify(packet.params));
      const request = pending.get(packet.id);
      if (!request) continue;
      clearTimeout(request.timer); pending.delete(packet.id);
      if (packet.error) request.reject(new Error(JSON.stringify(packet.error))); else request.resolve(packet.result);
    }
  });
  const command = (method: string, params: object = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    (browser.stdio[3] as Writable).write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  try {
    await build({ configFile: false, root, logLevel: 'error', plugins: [react(), tailwind()], define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: { outDir: directory, emptyOutDir: false, lib: { entry: path.join(root, 'web/src/test/dashboard-fixture.tsx'),
        formats: ['iife'], name: 'DashboardFixture', fileName: () => 'fixture.js', cssFileName: 'fixture' } } });
    fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><html lang="de"><head><meta charset="UTF-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    const send = (method: string, params: object = {}) => command(method, params, sessionId);
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1600, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(path.join(directory, 'index.html')).href });
    async function evaluate(expression: string) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    async function until(expression: string) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const debug = await evaluate(`document.body.innerText.slice(0,900)`);
      throw new Error(`Timed out: ${expression}\n${exceptions.join('\n')}\n${debug}`);
    }
    const click = (text: string) => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)} && !b.disabled)?.click()`);
    const rect = (id: string) => evaluate(`(()=>{const r=document.querySelector('[data-dashboard-widget="${id}"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const handle = (id: string) => evaluate(`(()=>{const r=document.querySelector('[data-dashboard-widget="${id}"] button[aria-label$="verschieben"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await until(`document.querySelector('[data-dashboard-widget="workflowCount"]')?.getBoundingClientRect().width>100`);
    const before = await rect('workflowCount');
    await click('Widgets anordnen');
    await until(`document.querySelector('button[aria-label="Workflows verschieben"]')`);
    const editing = await rect('workflowCount');
    assert.equal(editing.height, before.height, 'Edit controls must not enlarge the cards');
    const grid = await evaluate(`(()=>{const r=document.querySelector('[data-dashboard-widget]').parentElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}})()`);
    const start = await handle('workflowCount');
    assert.equal(await evaluate(`document.querySelector('button[aria-label="Workflows verschieben"]').disabled`), false);
    const x = grid.x + (grid.width + 24) / 12 * 9 + (start.x - editing.x);
    const y = grid.y + 400 + (start.y - editing.y);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
    assert.equal(await evaluate(`document.querySelector('button[aria-label="Workflows verschieben"]').hasPointerCapture(1)`), true);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y + 10, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await until(`document.querySelector('[data-drop-preview]')`);
    const preview = await evaluate(`(()=>{const r=document.querySelector('[data-drop-preview]').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
    assert.ok(Math.abs(preview.x - (grid.x + (grid.width + 24) / 12 * 9)) < 1);
    assert.ok(Math.abs(preview.y - grid.y - 400) < 1);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await until(`!document.querySelector('[data-drop-preview]')`);
    await click('Speichern');
    await until(`JSON.parse(localStorage.getItem('fixture-layout')||'null')?.positions.wide.workflowCount.top===400`);
    const saved = await evaluate(`JSON.parse(localStorage.getItem('fixture-layout'))`);
    assert.deepEqual(saved.positions.wide.workflowCount, { column: 9, top: 400 });
    await send('Page.reload');
    await until(`document.querySelector('[data-dashboard-widget="workflowCount"]')?.getBoundingClientRect().width>100`);
    const reloaded = await rect('workflowCount'), execution = await rect('executions');
    assert.ok(reloaded.x >= execution.x + execution.width, 'Workflows must stay beside execution history after reload');
    assert.ok(Math.abs(reloaded.y - execution.y) < 1);
    await click('Widgets anordnen');
    await until(`document.querySelector('button[aria-label="Workflows verschieben"]')`);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const touch = await handle('workflowCount'), card = await rect('workflowCount');
    const currentGrid = await evaluate(`(()=>{const r=document.querySelector('[data-dashboard-widget]').parentElement.getBoundingClientRect();return {x:r.x,y:r.y}})()`);
    const touchX = currentGrid.x + (touch.x - card.x), touchY = currentGrid.y + 360 + (touch.y - card.y);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touch.x, y: touch.y, id: 0 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX, y: touchY, id: 0 }] });
    await until(`document.querySelector('[data-drop-preview]')`);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(`!document.querySelector('[data-drop-preview]')`);
    const moved = await rect('workflowCount');
    assert.ok(Math.abs(moved.x - currentGrid.x) < 1, 'Touch must move to the selected free column');
    await click('Abbrechen');
    await until(`!document.querySelector('button[aria-label="Workflows verschieben"]')`);
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('fixture-layout')).positions.wide.workflowCount`), { column: 9, top: 400 });
    assert.ok((await rect('workflowCount')).x >= execution.x + execution.width);
    await click('Widgets anordnen');
    await until(`document.querySelector('button[aria-label="Workflows verschieben"]')`);
    const keyboardBefore = await rect('workflowCount');
    await evaluate(`document.querySelector('button[aria-label="Workflows verschieben"]').focus()`);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await until(`document.querySelector('[data-dashboard-widget="workflowCount"]').getBoundingClientRect().x < ${keyboardBefore.x - 5}`);
    await click('Abbrechen');
    await until(`!document.querySelector('button[aria-label="Workflows verschieben"]')`);
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('fixture-layout')).positions.wide.workflowCount`), { column: 9, top: 400 });
    assert.deepEqual(exceptions, []);
  } finally {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Browser test closing')); }
    pending.clear();
    browser.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (browser.exitCode !== null) resolve(); else browser.once('exit', () => resolve());
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
