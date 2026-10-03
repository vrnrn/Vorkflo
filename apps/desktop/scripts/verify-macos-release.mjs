#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { extractFile, listPackage } from '@electron/asar';

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = resolve(desktopDirectory, '../..');
const outputDirectory = join(desktopDirectory, 'release');
const options = parseArguments(process.argv.slice(2));

if (process.platform !== 'darwin') {
  throw new Error('macOS release verification must run on macOS.');
}

const rootPackage = JSON.parse(
  await readFile(join(repositoryDirectory, 'package.json'), 'utf8'),
);
const desktopPackage = JSON.parse(
  await readFile(join(desktopDirectory, 'package.json'), 'utf8'),
);
assert.match(desktopPackage.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
assert.equal(
  rootPackage.version,
  desktopPackage.version,
  'Root and desktop package versions must match before release.',
);

const verifiedArtifacts = [];
for (const architecture of options.architectures) {
  const artifactStem = `Vorkflo-${desktopPackage.version}-mac-${architecture}`;
  const dmgPath = join(outputDirectory, `${artifactStem}.dmg`);
  const zipPath = join(outputDirectory, `${artifactStem}.zip`);
  await assertArtifact(dmgPath);
  await assertArtifact(zipPath);

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), `vorkflo-${architecture}-release-`),
  );
  try {
    const zipDirectory = join(temporaryDirectory, 'zip');
    await mkdir(zipDirectory);
    run('ditto', ['-x', '-k', zipPath, zipDirectory]);
    const zipApp = await findApplication(zipDirectory);
    const zipBundle = await verifyApplicationBundle(zipApp, architecture);

    const mountDirectory = join(temporaryDirectory, 'dmg');
    await mkdir(mountDirectory);
    run('hdiutil', [
      'attach',
      dmgPath,
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      mountDirectory,
    ]);
    try {
      const dmgApp = await findApplication(mountDirectory);
      const dmgBundle = await verifyApplicationBundle(dmgApp, architecture);
      assert.equal(
        dmgBundle.asarHash,
        zipBundle.asarHash,
        `${basename(dmgPath)} and ${basename(zipPath)} must contain the same application payload.`,
      );
      await access(join(mountDirectory, 'Applications'));
    } finally {
      run('hdiutil', ['detach', mountDirectory]);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  verifiedArtifacts.push(dmgPath, zipPath);
}

if (options.writeManifest) {
  const manifest = `${(
    await Promise.all(
      verifiedArtifacts.map(
        async (path) => `${await sha256(path)}  ${basename(path)}`,
      ),
    )
  ).join('\n')}\n`;
  await writeFile(join(outputDirectory, 'SHA256SUMS.txt'), manifest, {
    mode: 0o644,
  });
}

console.log(
  `Verified ${options.mode} macOS ${desktopPackage.version} artifacts for ${options.architectures.join(', ')}.`,
);

async function verifyApplicationBundle(appPath, architecture) {
  const infoPath = join(appPath, 'Contents/Info.plist');
  assert.equal(
    plistValue(infoPath, 'CFBundleIdentifier'),
    'app.vorkflo.desktop',
  );
  assert.equal(
    plistValue(infoPath, 'CFBundleShortVersionString'),
    desktopPackage.version,
  );
  assert.equal(plistValue(infoPath, 'CFBundleVersion'), desktopPackage.version);
  assert.equal(
    plistValue(infoPath, 'CFBundleIconFile'),
    'icon.icns',
    'The packaged application must use the Vorkflo icon.',
  );
  assert.equal(
    plistValue(infoPath, 'LSMinimumSystemVersion'),
    '12.0',
    'The documented minimum macOS version must be explicit in the bundle.',
  );

  const executable = join(appPath, 'Contents/MacOS/Vorkflo');
  const executableArchitectures = run('lipo', ['-archs', executable])
    .stdout.trim()
    .split(/\s+/);
  const expectedArchitecture = architecture === 'x64' ? 'x86_64' : architecture;
  assert.ok(
    executableArchitectures.includes(expectedArchitecture),
    `${basename(appPath)} does not contain ${expectedArchitecture} code.`,
  );

  const asarPath = join(appPath, 'Contents/Resources/app.asar');
  for (const helper of [
    'mcp-policy-proxy/src/cli.js',
    'markdown-context-runner/src/image-report-cli.js',
  ]) {
    await access(join(appPath, 'Contents/Resources/helpers', helper));
  }
  await access(join(appPath, 'Contents/Resources/icon.icns'));
  const entries = listPackage(asarPath);
  for (const requiredEntry of [
    '/out/main/index.js',
    '/out/preload/index.cjs',
    '/out/renderer/index.html',
  ]) {
    assert.ok(
      entries.includes(requiredEntry),
      `Packaged application is missing ${requiredEntry}.`,
    );
  }
  assert.ok(
    !entries.some(
      (entry) =>
        entry.endsWith('.map') ||
        entry.includes('/@vorkflo/engine/src/') ||
        entry.includes('/@vorkflo/node-runner/src/') ||
        entry.includes('/@vorkflo/engine/test/') ||
        entry.includes('/@vorkflo/node-runner/test/'),
    ),
    'Packaged application contains development sources, tests, or source maps.',
  );
  const metadata = JSON.parse(
    extractFile(asarPath, 'package.json').toString('utf8'),
  );
  assert.equal(metadata.author, 'Vorkflo contributors');

  const mainBundle = extractFile(asarPath, 'out/main/index.js').toString(
    'utf8',
  );
  assert.match(mainBundle, /contextIsolation:\s*true/);
  assert.match(mainBundle, /nodeIntegration:\s*false/);
  assert.match(mainBundle, /sandbox:\s*true/);
  const preloadBundle = extractFile(asarPath, 'out/preload/index.cjs').toString(
    'utf8',
  );
  assert.match(preloadBundle, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preloadBundle, /nodeIntegration:\s*true/);

  verifyUnsignedDistribution(appPath);

  return { asarHash: await sha256(asarPath) };
}

function verifyUnsignedDistribution(appPath) {
  const signature = runAllowFailure('codesign', [
    '--display',
    '--verbose=4',
    appPath,
  ]).combined;
  assert.doesNotMatch(
    signature,
    /Authority=Developer ID Application:/,
    'The v0.2 release policy requires an unsigned distribution.',
  );
  assert.doesNotMatch(
    signature,
    /TeamIdentifier=(?!not set)[A-Z0-9]+/,
    'The unsigned application must not carry a distribution team identity.',
  );
}

async function assertArtifact(path) {
  const details = await stat(path);
  assert.ok(details.isFile(), `${path} is not a file.`);
  assert.ok(details.size > 1_000_000, `${path} is unexpectedly small.`);
}

async function findApplication(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const application = entries.find(
    (entry) => entry.isDirectory() && entry.name === 'Vorkflo.app',
  );
  assert.notEqual(
    application,
    undefined,
    `Vorkflo.app is missing from ${directory}.`,
  );
  return join(directory, application.name);
}

function plistValue(plistPath, key) {
  return run('plutil', [
    '-extract',
    key,
    'raw',
    '-o',
    '-',
    plistPath,
  ]).stdout.trim();
}

async function sha256(path) {
  const contents = await readFile(path);
  return createHash('sha256').update(contents).digest('hex');
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(' ')} failed with status ${String(result.status)}.\n${stdout}${stderr}`,
    );
  }
  return { stdout, stderr, combined: `${stdout}${stderr}` };
}

function runAllowFailure(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { stdout, stderr, combined: `${stdout}${stderr}` };
}

function parseArguments(arguments_) {
  let mode = 'unsigned';
  let architectures;
  let writeManifest = false;
  for (const argument of arguments_) {
    if (argument === '--unsigned') mode = 'unsigned';
    else if (argument === '--write-manifest') writeManifest = true;
    else if (argument.startsWith('--architectures=')) {
      architectures = argument
        .slice('--architectures='.length)
        .split(',')
        .filter(Boolean);
    } else {
      throw new Error(`Unknown release-verification option: ${argument}`);
    }
  }
  const resolvedArchitectures = architectures ?? [
    process.arch === 'x64' ? 'x64' : 'arm64',
  ];
  for (const architecture of resolvedArchitectures) {
    if (architecture !== 'arm64' && architecture !== 'x64') {
      throw new Error(`Unsupported macOS architecture: ${architecture}`);
    }
  }
  return { mode, architectures: resolvedArchitectures, writeManifest };
}
