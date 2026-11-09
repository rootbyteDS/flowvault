import fs from 'node:fs';
import { currentBuild } from '../server/version.ts';

const file = new URL('../dist/build-info.json', import.meta.url);
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ ...currentBuild(), builtAt: new Date().toISOString() }, null, 2) + '\n');
