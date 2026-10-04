import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

export function createPreviewServer(directory) {
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let target = path.resolve(directory, `.${decodeURIComponent(url.pathname)}`);
      if (target !== directory && !target.startsWith(`${directory}${path.sep}`)) {
        res.writeHead(403);
        res.end();
        return;
      }
      let status = 200;
      try {
        if ((await fs.stat(target)).isDirectory()) {
          if (!url.pathname.endsWith('/')) {
            res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
            res.end();
            return;
          }
          target = path.join(target, 'index.html');
        }
        await fs.access(target);
      } catch {
        target = path.join(directory, '404.html');
        status = 404;
      }
      const bytes = await fs.readFile(target);
      const headers = {
        'Content-Type': types[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        Vary: 'Accept-Encoding',
      };
      const gzip = (req.headers['accept-encoding'] || '')
        .split(',')
        .some((value) => /^\s*gzip\s*(?:;\s*q=(?!0(?:\.0*)?\s*$)[\d.]+)?\s*$/i.test(value));
      const encoded = gzip ? gzipSync(bytes) : bytes;
      if (gzip) headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = encoded.length;
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : encoded);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid request.');
    }
  });
}
