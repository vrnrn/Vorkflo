import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './files.mjs';

const origin = 'https://vorkflo.vrnrn.com';
const source = path.join(root, 'src');
const destination = path.join(root, 'dist');
const staging = await fs.mkdtemp(path.join(root, '.build-site-'));

// Publish only the standalone website, never application code or documentation.
try {
  for (const file of [
    'index.html',
    'style.css',
    'app.js',
    'assets/icon.png',
    'assets/editor.png',
    'assets/LICENSE.txt',
  ]) {
    const target = path.join(staging, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(source, file), target);
  }
  await fs.writeFile(
    path.join(staging, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
  );
  await fs.writeFile(
    path.join(staging, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>\n`,
  );
  await fs.writeFile(
    path.join(staging, '404.html'),
    `<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — Vorkflo</title><link rel="stylesheet" href="/style.css"><body><main class="wrap section-space"><p class="eyebrow">VORKFLO</p><h1>Lost the flow?</h1><p class="hero-description">This page could not be found.</p><p class="hero-actions error-actions"><a class="button" href="/">Back to Vorkflo</a></p></main></body></html>\n`,
  );
  await fs.writeFile(
    path.join(staging, '_headers'),
    `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'\n`,
  );
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(staging, destination);
  console.log('Built Vorkflo landing page in site/dist/ for vorkflo.vrnrn.com.');
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
