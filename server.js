const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const port = 3000;

function makeImmichRequest(immichUrl, apiKey, apiPath, method, res, label) {
  const fullUrl = `${immichUrl.replace(/\/$/, '')}${apiPath}`;
  console.log(`[${label}] ${method} ${fullUrl}`);

  const parsed = new URL(fullUrl);
  const lib = parsed.protocol === 'https:' ? https : http;

  const proxyReq = lib.request({
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + (parsed.search || ''),
    method,
    headers: { 'x-api-key': apiKey }
  }, proxyRes => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      console.log(`[${label}] Response: ${proxyRes.statusCode} ${proxyRes.statusMessage}`);
      const contentType = proxyRes.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        console.error(`[${label}] Got HTML instead of JSON — is the Immich URL correct?`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server returned HTML — is the Immich URL correct?' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: proxyRes.statusCode, body: data }));
    });
  });

  proxyReq.on('error', err => {
    console.error(`[${label}] Error:`, err.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  proxyReq.end();
}

function parseBody(req, cb) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { cb(null, JSON.parse(body)); } catch (e) { cb(e); }
  });
}

function proxyTestConnection(req, res) {
  parseBody(req, (err, data) => {
    if (err) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid body' })); }
    makeImmichRequest(data.url, data.apiKey, '/api/albums', 'GET', res, 'Connection Test');
  });
}

function proxyFetchAlbums(req, res) {
  parseBody(req, (err, data) => {
    if (err) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid body' })); }
    makeImmichRequest(data.url, data.apiKey, '/api/albums', 'GET', res, 'Albums');
  });
}

function proxyUploadAsset(req, res) {
  const reqUrl = new URL(req.url, `http://localhost`);
  const immichUrl = reqUrl.searchParams.get('url');
  const apiKey = reqUrl.searchParams.get('apiKey');

  const targetUrl = `${immichUrl.replace(/\/$/, '')}/api/assets`;
  console.log('[Upload] POST', targetUrl);

  const parsed = new URL(targetUrl);
  const lib = parsed.protocol === 'https:' ? https : http;

  const proxyReq = lib.request({
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname,
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': req.headers['content-type'],
      ...(req.headers['content-length'] && { 'content-length': req.headers['content-length'] }),
    }
  }, proxyRes => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      console.log(`[Upload] Response: ${proxyRes.statusCode} ${proxyRes.statusMessage}`);
      if (proxyRes.statusCode >= 400) console.error('[Upload] Error body:', data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: proxyRes.statusCode, body: data }));
    });
  });

  proxyReq.on('error', err => {
    console.error('[Upload] Error:', err.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
}

function proxyAddToAlbum(req, res) {
  parseBody(req, (err, data) => {
    if (err) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid body' })); }
    const { url: immichUrl, apiKey, albumId, assetIds } = data;
    const targetUrl = `${immichUrl.replace(/\/$/, '')}/api/albums/${albumId}/assets`;
    console.log('[Add to Album] PUT', targetUrl);

    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const body = JSON.stringify({ ids: assetIds });

    const proxyReq = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'PUT',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      }
    }, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        console.log(`[Add to Album] Response: ${proxyRes.statusCode} ${proxyRes.statusMessage}`);
        if (proxyRes.statusCode >= 400) console.error('[Add to Album] Error body:', data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: proxyRes.statusCode, body: data }));
      });
    });

    proxyReq.on('error', err => {
      console.error('[Add to Album] Error:', err.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    proxyReq.write(body);
    proxyReq.end();
  });
}

const staticFiles = {
  '/manifest.json': { file: 'manifest.json', type: 'application/manifest+json' },
  '/icon.svg':      { file: 'icon.svg',      type: 'image/svg+xml' },
  '/sw.js':         { file: 'sw.js',         type: 'application/javascript' },
};

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/test-connection') return proxyTestConnection(req, res);
  if (req.method === 'POST' && req.url === '/fetch-albums') return proxyFetchAlbums(req, res);
  if (req.method === 'POST' && req.url.startsWith('/proxy-upload')) return proxyUploadAsset(req, res);
  if (req.method === 'PUT' && req.url === '/proxy-add-to-album') return proxyAddToAlbum(req, res);

  const staticMatch = staticFiles[req.url];
  if (staticMatch) {
    return fs.readFile(path.join(__dirname, staticMatch.file), (err, content) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': staticMatch.type });
      res.end(content);
    });
  }

  fs.readFile(path.join(__dirname, 'immich-artwork-camera.html'), (err, content) => {
    if (err) { res.writeHead(500); return res.end('Error loading file'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  });
}).listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
