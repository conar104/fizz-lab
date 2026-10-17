// Minimal static file server for local development:  node tools/serve.js [port]
// (port: the argument, else the PORT environment variable, else 5173)
// (Opening index.html directly also works; this is just for browsers/tools
// that block scripts on file:// pages.)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2]) || Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/plain', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use (another Fizz Lab server may still be running). Stop it, or run: node tools/serve.js <other port>`);
    process.exit(1);
  }
  throw err;
}).listen(port, '127.0.0.1', () => console.log(`Fizz Lab on http://localhost:${port}`));
