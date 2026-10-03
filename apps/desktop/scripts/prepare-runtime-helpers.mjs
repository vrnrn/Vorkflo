#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(desktop, '../..');
const output = join(desktop, 'resources/helpers');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['mcp-policy-proxy', 'markdown-context-runner']) {
  const destination = join(output, name);
  // Node subprocesses cannot read Electron ASAR archives. Keep only executable
  // JavaScript outside the archive; source maps and test builds stay behind.
  await cp(
    join(repository, 'packages', name, 'dist/src'),
    join(destination, 'src'),
    {
      recursive: true,
      filter: (path) => !path.endsWith('.map') && !path.endsWith('.ts'),
    },
  );
  await writeFile(join(destination, 'package.json'), '{"type":"module"}\n');
}
console.log('Prepared application runtime helpers.');
