#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u],
  ['api-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/u],
  ['cloud-key', /\bAKIA[A-Z0-9]{16}\b/u],
  ['credential-url', /https?:\/\/[^\s/]+:[^\s/@]+@[^\s/]+/u],
];
const syntheticUsers = new Set([
  'test',
  'user',
  'developer',
  'example',
  'runner',
  'workflow',
]);

/** Report locations and rule names only; never echo a detected credential. */
export function inspectPublicText(path, content) {
  const issues = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    for (const [rule, pattern] of rules) {
      // Credential-URL rejection fixtures are synthetic, not stored credentials.
      if (
        rule === 'credential-url' &&
        path.includes('/test/') &&
        /@(?:www\.)?example\.com\b/u.test(line)
      )
        continue;
      if (pattern.test(line)) issues.push({ path, line: index + 1, rule });
    }
    for (const match of line.matchAll(
      /(?<![\w/])\/(?:Users|home)\/([\w.-]+)(?=\/|["'\s]|$)/gu,
    )) {
      if (!syntheticUsers.has(match[1]))
        issues.push({ path, line: index + 1, rule: 'personal-home-path' });
    }
    for (const match of line.matchAll(
      /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/gu,
    )) {
      // Registry metadata can contain upstream maintainers' public contact details.
      if (path === 'package-lock.json') continue;
      if (
        !/(?:\.(?:png|invalid)$|(?:^|\.)example\.com$|^users\.noreply\.github\.com$)/u.test(
          match[1],
        )
      )
        issues.push({ path, line: index + 1, rule: 'personal-email' });
    }
  }
  return issues;
}

async function main() {
  const paths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const issues = [];
  for (const path of new Set(paths)) {
    if (/\.(?:png|icns)$/u.test(path)) continue;
    if (
      /(?:^|\/)(?:\.env(?!\.example$)|run-history\.json)|\.(?:pem|key|log)$/u.test(
        path,
      )
    ) {
      issues.push({ path, line: 1, rule: 'private-file' });
      continue;
    }
    issues.push(...inspectPublicText(path, await readFile(path, 'utf8')));
  }
  if (issues.length > 0) {
    for (const issue of issues)
      console.error(`${issue.path}:${issue.line} ${issue.rule}`);
    process.exitCode = 1;
  } else
    console.log(
      `Public-source audit passed (${new Set(paths).size} files). Review image pixels and Git history separately.`,
    );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
