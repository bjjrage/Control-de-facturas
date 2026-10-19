// Local-only audit server. No deploy, credentials remain in process memory.
const { root, env, session, assert } = require('./context.cjs');
const { spawn } = require('node:child_process');
const http = require('node:http');
const cron = 'isolated-local-audit-' + require('node:crypto').randomUUID();
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3018', '-H', '127.0.0.1'], {
 cwd: root, env: { ...process.env, ...env, CRON_SECRET: cron }, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
});
// Set official OTP-exchanged cookies on localhost, never emit credentials in logs.
http.createServer(async (req, res) => {
 try {
  if (req.url === '/login') {
   const s = await session();
   res.writeHead(302, { 'Set-Cookie': s.jar.map(c => `${c.name}=${c.value}; Path=/; HttpOnly; SameSite=Lax`), location: 'http://localhost:3018/dashboard' });
   return res.end();
  }
  if (req.url.startsWith('/cron?')) {
   const url = new URL(req.url, 'http://localhost');
   const r = await fetch('http://localhost:3018/api/cron/climate-evaluation?' + url.searchParams, { headers: { authorization: 'Bearer ' + cron } });
   res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(await r.text());
  }
  res.writeHead(404); res.end();
 } catch { res.writeHead(500); res.end('Audit helper failed'); }
}).listen(4019, '127.0.0.1', () => console.log('Local QA helper :4019, isolated ref verified; no stored CRON_SECRET'));
process.on('exit', () => child.kill());
child.on('exit', code => process.exit(code || 0));
