import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { finalizeMarkdownPngReference } from '../src/index.js';

const pngFixture = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test('copies a PNG beside the report and writes a portable relative reference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-local-image-'));
  const reportDirectory = join(directory, 'reports');
  const sourceDirectory = join(directory, 'captures');
  await Promise.all([
    mkdir(reportDirectory, { recursive: true }),
    mkdir(sourceDirectory, { recursive: true }),
  ]);
  const reportPath = join(reportDirectory, 'report.md');
  const imagePath = join(sourceDirectory, 'chart.png');
  await writeFile(imagePath, pngFixture);
  await writeFile(
    reportPath,
    `# Report\n\n## Evidence image\n![Chart evidence](${imagePath})\n`,
    'utf8',
  );

  const result = await finalizeMarkdownPngReference(
    reportPath,
    imagePath,
    'Chart evidence',
  );
  const markdown = await readFile(reportPath, 'utf8');
  const renderedImage = await readFile(join(reportDirectory, 'chart.png'));

  assert.equal(result.bytes, pngFixture.length);
  assert.equal(result.renderedImagePath, join(reportDirectory, 'chart.png'));
  assert.deepEqual(renderedImage, pngFixture);
  assert.doesNotMatch(markdown, new RegExp(imagePath, 'u'));
  assert.match(markdown, /!\[Chart evidence\]\(\.\/chart\.png\)/u);
  assert.doesNotMatch(markdown, /data:image/u);
});

test('rejects mismatched references and non-PNG image bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-local-image-'));
  const reportPath = join(directory, 'report.md');
  const imagePath = join(directory, 'chart.png');
  await writeFile(imagePath, 'not png', 'utf8');
  await writeFile(
    reportPath,
    '# Report\n\n## Evidence image\n![Chart evidence](other.png)\n',
    'utf8',
  );

  await assert.rejects(
    finalizeMarkdownPngReference(reportPath, imagePath, 'Chart evidence'),
    /not a valid PNG/u,
  );
});

test('keeps spaces and parentheses in portable image destinations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-local-image-'));
  const reportPath = join(directory, 'report.md');
  const imagePath = join(directory, 'evidence (1).png');
  await writeFile(imagePath, pngFixture);
  await writeFile(
    reportPath,
    `## Evidence image\n![Evidence](<${imagePath}>)\n`,
  );
  await finalizeMarkdownPngReference(reportPath, imagePath, 'Evidence');
  assert.equal(
    await readFile(reportPath, 'utf8'),
    '## Evidence image\n![Evidence](<./evidence (1).png>)\n',
  );
});
