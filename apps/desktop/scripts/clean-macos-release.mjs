#!/usr/bin/env node

import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDirectory = join(desktopDirectory, 'release');

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

console.log('Prepared clean Apple silicon release directory.');
