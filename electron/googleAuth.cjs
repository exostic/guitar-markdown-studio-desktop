// OAuth 2.0 for the desktop app, with nothing secret on the client: the
// implicit flow. The system browser opens Google's consent page for the
// app's public client id; Google redirects to a one-shot server on a fixed
// loopback address with the access token in the URL fragment; a tiny page
// served there hands the fragment to the server. The token lives an hour
// and is kept in memory only.
const crypto = require('node:crypto');
const http = require('node:http');
const { shell } = require('electron');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
// Registered once on the OAuth client as an authorized redirect URI.
const LOOPBACK_PORT = 43110;
const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/`;

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The token response Google puts in the fragment: access_token,
// expires_in, state, or error.
function parseFragment(fragment) {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  return Object.fromEntries(params.entries());
}

const RELAY_PAGE = `<!doctype html><meta charset="utf-8"><title>Guitar Markdown Studio</title>
<p id="msg" style="font:16px system-ui;padding:2rem">Connexion en cours…</p>
<script>
fetch("/token?" + location.hash.slice(1)).then(r => r.text()).then(t => { document.getElementById("msg").textContent = t; location.hash = ""; });
</script>`;

// { accessToken, expiresIn } from a fresh sign-in in the browser.
async function googleAuth({ clientId, scopes }) {
  if (!clientId) return { error: 'Identifiant client Google manquant.' };
  const state = base64url(crypto.randomBytes(16));
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `Le port ${LOOPBACK_PORT} est déjà utilisé.` : error.message)));
    server.listen(LOOPBACK_PORT, '127.0.0.1', resolve);
  });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Connexion Google : délai dépassé.'));
    }, 5 * 60 * 1000);
    server.on('request', (request, response) => {
      const url = new URL(request.url, REDIRECT_URI);
      if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(RELAY_PAGE);
        return;
      }
      if (url.pathname !== '/token') {
        response.writeHead(404).end();
        return;
      }
      const token = parseFragment(url.search.slice(1));
      const ok = token.state === state && token.access_token;
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(ok ? 'Connexion réussie, vous pouvez fermer cet onglet et revenir dans Guitar Markdown Studio.' : 'Connexion refusée.');
      clearTimeout(timer);
      server.close();
      if (ok) resolve({ accessToken: token.access_token, expiresIn: Number(token.expires_in) || 3600 });
      else reject(new Error(token.error ?? 'Connexion Google annulée.'));
    });
    // Exactly the scopes asked for: previously granted (broader) scopes must
    // not be folded back into this token, or Google warns about them again.
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'token', scope: scopes, state, include_granted_scopes: 'false',
    });
    shell.openExternal(`${AUTH_URL}?${params}`);
  });
  return result;
}

module.exports = { googleAuth, parseFragment, REDIRECT_URI };
