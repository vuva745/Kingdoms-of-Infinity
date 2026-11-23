// Runs the API server (with auto-reload) and the Vite dev server together.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const vitePkgPath = require.resolve('vite/package.json');
const viteBin = join(dirname(vitePkgPath), require(vitePkgPath).bin.vite);

const port = process.env.PORT ?? '3000';

const children = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT: port } }),
  spawn(process.execPath, [viteBin, '--host', '0.0.0.0'], { stdio: 'inherit', env: { ...process.env, API_URL: `http://localhost:${port}` } }),
];

function shutdown(code = 0) {
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exit(code);
}

for (const child of children) child.on('exit', (code) => shutdown(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
