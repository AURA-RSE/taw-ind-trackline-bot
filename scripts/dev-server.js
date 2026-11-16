// Local server that runs the same handlers as Vercel: node scripts/dev-server.js  (PORT=3000)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import * as whatsapp from '../api/whatsapp.js';
import * as vapi from '../api/vapi.js';
import * as track from '../api/track.js';
import * as health from '../api/health.js';
import * as chat from '../api/chat.js';

const routes = { '/api/whatsapp': whatsapp, '/api/vapi': vapi, '/api/track': track, '/api/health': health, '/api/chat': chat };
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const mod = routes[url.pathname];
  if (!mod) {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
    }
    res.writeHead(404); return res.end('not found');
  }
  const handler = mod[req.method];
  if (!handler) { res.writeHead(405); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`TrackLine dev server on http://localhost:${port}`));
