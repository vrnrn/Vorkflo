import path from 'node:path';
import { watch } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root } from './files.mjs';
import { createPreviewServer } from './server.mjs';

const build = promisify(execFile);
const port = Number(process.env.PORT || 4174);
let rebuilding = false;
let pending = false;

async function rebuild() {
  if (rebuilding) {
    pending = true;
    return;
  }
  rebuilding = true;
  try {
    const { stdout } = await build(process.execPath, ['scripts/build.mjs'], { cwd: root });
    console.log(stdout.trim());
  } finally {
    rebuilding = false;
  }
  if (pending) {
    pending = false;
    await rebuild();
  }
}

await rebuild();
const server = createPreviewServer(path.join(root, 'dist'));
server.listen(port, '127.0.0.1', () => console.log(`Vorkflo preview: http://127.0.0.1:${port}/`));
let timer;
const watcher = watch(path.join(root, 'src'), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => rebuild().catch((error) => console.error(error.message)), 120);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearTimeout(timer);
    watcher.close();
    server.close();
  });
}
