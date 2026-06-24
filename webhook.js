const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');

const SECRET = 'unicorns-deploy-secret';
const PORT = 9000;

http.createServer((req, res) => {
  if(req.method !== 'POST' || req.url !== '/deploy') {
    res.writeHead(404); res.end(); return;
  }
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    const sig = req.headers['x-hub-signature-256'];
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    if(sig !== expected) { res.writeHead(401); res.end(); return; }
    res.writeHead(200); res.end('OK');
    try {
      execSync('cd /root/unicorns && git reset --hard origin/main && git pull origin main && npm install && pm2 restart unicorns', {stdio:'inherit'});
      console.log('Deployed!');
    } catch(e) { console.error('Deploy failed:', e.message); }
  });
}).listen(PORT, () => console.log(`Webhook listening on port ${PORT}`));
