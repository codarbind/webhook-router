const http = require('http');
const url = require('url');
const fs = require('fs');
const querystring = require('querystring');

if (fs.existsSync('.env')) {
  fs.readFileSync('.env', 'utf-8')
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .forEach(line => {
      const [key, value] = line.split('=');
      process.env[key.trim()] = value.trim();
    });
}

const PORT = process.env.PORT;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

const DATA_FILE = './platforms.json';

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

function getMappings() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveMappings(mappings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(mappings, null, 2));
}

function send(res, status, content, contentType = 'text/html') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(content);
}

function isAuthenticated(req) {
  const auth = req.headers['authorization'];
  if (!auth) return false;
  const token = auth.split(' ')[1];
  const decoded = Buffer.from(token, 'base64').toString();
  const [user, pass] = decoded.split(':');
  return user === ADMIN_USER && pass === ADMIN_PASS;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // --- Webhook endpoint ---
  if (req.method === 'POST' && parsedUrl.pathname === '/webhook/paystack') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const event = JSON.parse(body);
        const platform = event?.data?.metadata?.platform;

        if (!platform) {
          console.warn('No platform in metadata');
          return send(res, 200, 'OK', 'text/plain');
        }

        const mappings = getMappings();
        const mapping = mappings.find(m => m.platform === platform);

        if (!mapping) {
          console.warn(`No webhook URL for platform: ${platform}`);
          return send(res, 200, 'OK', 'text/plain');
        }

        console.log(`Forwarding to ${mapping.webhookUrl} for ${platform}`);
        await fetch(mapping.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body
        });

        send(res, 200, 'OK', 'text/plain');
      } catch (err) {
        console.error('Error handling webhook:', err.message);
        send(res, 500, 'Error', 'text/plain');
      }
    });
    return;
  }

  // --- Admin: List mappings ---
  if (req.method === 'GET' && parsedUrl.pathname === '/admin') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic' });
      return res.end('Authentication required');
    }

    const mappings = getMappings();
    let html = `<h1>Platform Webhook Directory</h1>
      <form method="POST" action="/admin/add">
        <input name="platform" placeholder="Platform" required>
        <input name="webhookUrl" placeholder="Webhook URL" required>
        <button type="submit">Add / Update</button>
      </form>
      <ul>`;
    mappings.forEach(m => {
      html += `<li><b>${m.platform}</b> => ${m.webhookUrl}
        <a href="/admin/delete?platform=${encodeURIComponent(m.platform)}">Delete</a></li>`;
    });
    html += `</ul>`;
    return send(res, 200, html);
  }

  // --- Admin: Add/Update mapping ---
  if (req.method === 'POST' && parsedUrl.pathname === '/admin/add') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic' });
      return res.end('Authentication required');
    }

    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      const { platform, webhookUrl } = querystring.parse(body);
      let mappings = getMappings();
      const index = mappings.findIndex(m => m.platform === platform);

      if (index >= 0) {
        mappings[index].webhookUrl = webhookUrl;
      } else {
        mappings.push({ platform, webhookUrl });
      }

      saveMappings(mappings);
      res.writeHead(302, { Location: '/admin' });
      res.end();
    });
    return;
  }

  // --- Admin: Delete mapping ---
  if (req.method === 'GET' && parsedUrl.pathname === '/admin/delete') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic' });
      return res.end('Authentication required');
    }

    const platform = parsedUrl.query.platform;
    let mappings = getMappings().filter(m => m.platform !== platform);
    saveMappings(mappings);
    res.writeHead(302, { Location: '/admin' });
    res.end();
    return;
  }

  // --- Not found ---
  send(res, 404, 'Not Found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`Webhook router running on port ${PORT}`);
});
