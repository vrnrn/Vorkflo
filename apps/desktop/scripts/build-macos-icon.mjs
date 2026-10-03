#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('The macOS icon build requires sips and iconutil on macOS.');
}

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(desktopDirectory, 'build/icon.png');
const destination = join(desktopDirectory, 'build/icon.icns');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vorkflo-icon-'));
const sourcePng = join(temporaryDirectory, 'icon-1024.png');
const iconset = join(temporaryDirectory, 'icon.iconset');

try {
  await mkdir(iconset);
  execFileSync('sips', ['-s', 'format', 'png', source, '--out', sourcePng], {
    stdio: 'ignore',
  });
  for (const [name, size] of [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
  ]) {
    execFileSync(
      'sips',
      [
        '-z',
        String(size),
        String(size),
        sourcePng,
        '--out',
        join(iconset, name),
      ],
      { stdio: 'ignore' },
    );
  }
  await cp(sourcePng, join(iconset, 'icon_512x512@2x.png'));
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', destination]);
  console.log(`Generated ${destination} from ${source}.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
