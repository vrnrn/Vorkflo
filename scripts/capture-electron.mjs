#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import process from 'node:process';

import { connectElectron } from './electron-driver.mjs';
const outputPath = process.argv[3] ?? 'artifacts/desktop.png';
const { command, evaluate, waitFor, exceptions, close, page } =
  await connectElectron(process.argv[2]);

await command('Page.enable');
await command('Runtime.enable');
await command('Log.enable');
await command('Page.bringToFront');

await waitFor(
  'document.querySelector(".app-shell") !== null',
  'mounted editor',
);
if (exceptions.length > 0)
  throw new Error(`Renderer errors: ${exceptions.join(', ')}`);

const result = await command('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
});
await writeFile(outputPath, Buffer.from(result.data, 'base64'));
close();
console.log(`Captured ${page.title} to ${outputPath}`);
