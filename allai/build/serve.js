/* ===========================================================================
 * ALLAI — local development server
 *
 * Only needed while working on the SOURCE. A browser refuses to load
 * JavaScript modules from a file:// page, so `index.html` needs to be served
 * over http:// to run un-built.
 *
 * The finished dist/allai.html needs none of this — that is the entire point
 * of it. It opens straight off the phone.
 *
 *     npm run serve    then open http://localhost:8080
 *
 * No dependencies. It only ever serves files from inside this project.
 * ======================================================================== */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const target = path.join(ROOT, url === '/' ? 'index.html' : url);

  // Refuse anything that resolves outside the project, so a stray "../.."
  // cannot read the rest of the machine.
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + url); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`ALLAI source is being served at http://localhost:${PORT}`);
  console.log('This is for development only. The phone uses dist/allai.html instead.');
});
