import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, walk } from './files.mjs';

const directory = path.join(root, 'dist');
const files = await walk(directory);
const source = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
const origin = 'https://vorkflo.vrnrn.com/';
const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Unique page and SVG symbol IDs');
assert.equal((source.match(/<h1[ >]/g) || []).length, 1, 'One primary heading');
assert.ok(ids.includes('content'), 'Skip-link destination');
assert.ok(source.includes(`rel="canonical" href="${origin}"`), 'Product canonical URL');
assert.ok(source.includes(`property="og:url" content="${origin}"`), 'Product sharing URL');
assert.ok(source.includes('name="description"'), 'Page description');
assert.ok(source.includes('property="og:image"'), 'Social preview image');
const data = JSON.parse(
  source.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
);
assert.equal(data['@context'], 'https://schema.org', 'Structured data vocabulary');
assert.equal(
  data['@graph'].find((item) => item['@type'] === 'WebSite').url,
  origin,
  'Product site identity',
);
assert.equal(
  data['@graph'].find((item) => item['@type'] === 'WebPage').url,
  origin,
  'Product page canonical',
);
assert.ok(source.includes('Unsigned release'), 'Accurate download requirements');
assert.ok(source.includes('The demo is simulated in your browser.'), 'Clear demo scope');

for (const [, href] of source.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  if (href === '#') continue;
  const url = new URL(href, origin);
  if (url.origin !== new URL(origin).origin) continue;
  if (url.pathname === '/' && url.hash) {
    assert.ok(ids.includes(url.hash.slice(1)), `Missing anchor ${href}`);
  } else if (url.pathname !== '/') {
    assert.ok(files.includes(path.join(directory, url.pathname)), `Missing asset ${href}`);
  }
}
for (const [, attributes] of source.matchAll(/<a\b([^>]*\btarget="_blank"[^>]*)>/g)) {
  assert.match(attributes, /rel="noopener noreferrer"/, 'Isolated external tabs');
}
assert.equal(
  (
    source.match(
      /href="https:\/\/github\.com\/vrnrn\/Vorkflo\/releases\/download\/v0\.4\.0\/Vorkflo-0\.4\.0-mac-arm64\.dmg"/g,
    ) || []
  ).length,
  2,
  'Both download buttons point to the verified release',
);
assert.equal(files.length, 10, 'Only intended publication files');
assert.ok(
  files.every((file) => !/\.(?:md|mjs|map)$/.test(file)),
  'No source or documentation in output',
);
assert.ok(
  (await fs.readFile(path.join(directory, 'robots.txt'), 'utf8')).includes(`${origin}sitemap.xml`),
  'Crawler sitemap',
);
assert.ok(
  (await fs.readFile(path.join(directory, 'sitemap.xml'), 'utf8')).includes(`<loc>${origin}</loc>`),
  'Product sitemap',
);
assert.ok(
  (await fs.readFile(path.join(directory, '404.html'), 'utf8')).includes('content="noindex"'),
  '404 excluded from indexing',
);
for (const file of ['style.css', 'app.js']) {
  assert.ok(
    (await fs.readFile(path.join(directory, file), 'utf8')).includes('prefers-reduced-motion'),
    `${file}: reduced motion`,
  );
}
for (const file of ['src/app.js', 'scripts/build.mjs', 'scripts/dev.mjs', 'scripts/server.mjs']) {
  execFileSync(process.execPath, ['--check', path.join(root, file)]);
}
console.log(
  'Validated Vorkflo assets, anchors, download links, metadata, publication files, and JavaScript syntax.',
);
