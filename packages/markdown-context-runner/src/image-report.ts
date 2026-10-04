import { randomUUID } from 'node:crypto';
import {
  copyFile,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface FinalizedMarkdownImage {
  readonly reportPath: string;
  readonly sourceImagePath: string;
  readonly renderedImagePath: string;
  readonly bytes: number;
}

function parseEvidenceImage(markdown: string): {
  readonly full: string;
  readonly alt: string;
  readonly source: string;
} {
  const match =
    /(?:^|\n)## Evidence image[ \t]*\n(?:\n)?(!\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\)\n]+))\))[ \t]*(?=\n|$)/u.exec(
      markdown.replaceAll('\r\n', '\n'),
    );
  const source = match?.[3] ?? match?.[4];
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    source === undefined
  ) {
    throw new Error(
      'Markdown report must contain one Evidence image section with an image reference.',
    );
  }
  return { full: match[1], alt: match[2], source };
}

export async function finalizeMarkdownPngReference(
  reportPath: string,
  imagePath: string,
  expectedAlt: string,
): Promise<FinalizedMarkdownImage> {
  const resolvedReportPath = resolve(reportPath);
  const resolvedImagePath = resolve(imagePath);
  const [markdown, image, reportMetadata] = await Promise.all([
    readFile(resolvedReportPath, 'utf8'),
    readFile(resolvedImagePath),
    stat(resolvedReportPath),
  ]);
  if (
    image.length < pngSignature.length ||
    !image.subarray(0, pngSignature.length).equals(pngSignature)
  ) {
    throw new Error(`Evidence image is not a valid PNG: ${resolvedImagePath}`);
  }
  const reference = parseEvidenceImage(markdown);
  if (reference.alt !== expectedAlt) {
    throw new Error(
      `Evidence image alt text must equal ${JSON.stringify(expectedAlt)}.`,
    );
  }
  const referencedPath = resolve(dirname(resolvedReportPath), reference.source);
  if (referencedPath !== resolvedImagePath) {
    throw new Error(
      `Evidence image reference ${JSON.stringify(reference.source)} does not match ${resolvedImagePath}.`,
    );
  }
  const renderedImagePath = join(
    dirname(resolvedReportPath),
    basename(resolvedImagePath),
  );
  if (renderedImagePath !== resolvedImagePath) {
    const temporaryImagePath = join(
      dirname(renderedImagePath),
      `.${basename(renderedImagePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await copyFile(resolvedImagePath, temporaryImagePath);
      await rename(temporaryImagePath, renderedImagePath);
    } catch (error) {
      await unlink(temporaryImagePath).catch(() => undefined);
      throw error;
    }
  }
  const destination = `./${basename(renderedImagePath)}`;
  const relativeReference = `![${reference.alt}](${/[\s()]/u.test(destination) ? `<${destination}>` : destination})`;
  const output = markdown.replace(reference.full, relativeReference);
  const temporaryPath = join(
    dirname(resolvedReportPath),
    `.${basename(resolvedReportPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, output, {
      encoding: 'utf8',
      flag: 'wx',
      mode: reportMetadata.mode,
    });
    await rename(temporaryPath, resolvedReportPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return {
    reportPath: resolvedReportPath,
    sourceImagePath: resolvedImagePath,
    renderedImagePath,
    bytes: image.length,
  };
}
