import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { SocialApi } from '@shared/social'

const RECOVERY_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VNStation — Reset Password</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0c0e1c;
      --card: #14182d;
      --border: rgba(157, 180, 255, 0.18);
      --accent: #7da2ff;
      --accent-strong: #5b85ff;
      --text: #f1f4ff;
      --muted: #9aa4c7;
      --danger: #ff7a8a;
      --ok: #5eead4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: radial-gradient(circle at 50% 0%, #1b2242 0%, var(--bg) 70%);
      color: var(--text);
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.48);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 20px;
      font-weight: 700;
    }
    p.sub {
      margin: 0 0 20px;
      color: var(--muted);
      font-size: 13.5px;
      line-height: 1.5;
    }
    label {
      display: block;
      margin-bottom: 14px;
    }
    label span {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(8, 10, 22, 0.75);
      color: var(--text);
      font-size: 14px;
      outline: none;
    }
    input:focus {
      border-color: var(--accent);
    }
    button {
      width: 100%;
      margin-top: 6px;
      padding: 11px 16px;
      border-radius: 10px;
      border: none;
      background: linear-gradient(135deg, var(--accent), var(--accent-strong));
      color: #080b18;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .msg {
      margin-top: 14px;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.45;
      display: none;
    }
    .msg.error {
      display: block;
      background: rgba(255, 122, 138, 0.12);
      border: 1px solid rgba(255, 122, 138, 0.35);
      color: var(--danger);
    }
    .msg.ok {
      display: block;
      background: rgba(94, 234, 212, 0.12);
      border: 1px solid rgba(94, 234, 212, 0.35);
      color: var(--ok);
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>VNStation Password Reset</h1>
    <p class="sub">Choose a new password for your VNStation social account. It will sign you into the VNStation desktop app automatically.</p>
    <form id="resetForm">
      <label>
        <span>Email address</span>
        <input id="email" type="email" required placeholder="reader@example.com" />
      </label>
      <label>
        <span>New password (at least 8 characters)</span>
        <input id="password" type="password" required minlength="8" placeholder="••••••••" />
      </label>
      <label>
        <span>Confirm new password</span>
        <input id="confirm" type="password" required minlength="8" placeholder="••••••••" />
      </label>
      <button id="submitBtn" type="submit">Update Password & Sign In</button>
      <div id="status" class="msg" role="alert"></div>
    </form>
  </main>
  <script>
    (function () {
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash || window.location.search);
      const accessToken = params.get('access_token') || '';
      const emailInput = document.getElementById('email');
      const passInput = document.getElementById('password');
      const confirmInput = document.getElementById('confirm');
      const statusBox = document.getElementById('status');
      const submitBtn = document.getElementById('submitBtn');

      if (accessToken) {
        try {
          const parts = accessToken.split('.');
          if (parts.length >= 2) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (payload && payload.email) {
              emailInput.value = payload.email;
            }
          }
        } catch (_e) {}
      }

      document.getElementById('resetForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        statusBox.className = 'msg';
        statusBox.textContent = '';

        const email = emailInput.value.trim();
        const newPassword = passInput.value;
        const confirmPassword = confirmInput.value;

        if (newPassword.length < 8) {
          statusBox.className = 'msg error';
          statusBox.textContent = 'New password must be at least 8 characters.';
          return;
        }
        if (newPassword !== confirmPassword) {
          statusBox.className = 'msg error';
          statusBox.textContent = 'Passwords do not match.';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating password…';
        try {
          const res = await fetch('/api/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: email,
              newPassword: newPassword,
              recoveryAccessToken: accessToken
            })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.message || 'Could not reset password.');
          }
          statusBox.className = 'msg ok';
          statusBox.textContent = 'Password updated! You are now signed in to the VNStation desktop app. You may close this browser tab.';
          submitBtn.textContent = 'Password Updated';
        } catch (err) {
          statusBox.className = 'msg error';
          statusBox.textContent = err && err.message ? err.message : 'Password reset failed.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update Password & Sign In';
        }
      });
    })();
  </script>
</body>
</html>`

export function startLocalRecoveryServer(
  social: SocialApi,
  onSuccessFocusWindow?: () => void,
  port = 3000
): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const url = req.url ?? '/'

    if (method === 'POST' && url.startsWith('/api/reset')) {
      let raw = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => {
        if (raw.length < 16_384) raw += chunk
      })
      req.on('end', () => {
        void (async () => {
          try {
            const parsed = JSON.parse(raw || '{}') as {
              email?: string
              newPassword?: string
              recoveryAccessToken?: string
            }
            const state = await social.resetPassword({
              email: String(parsed.email ?? ''),
              newPassword: String(parsed.newPassword ?? ''),
              recoveryAccessToken: parsed.recoveryAccessToken
                ? String(parsed.recoveryAccessToken)
                : undefined
            })
            onSuccessFocusWindow?.()
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(
              JSON.stringify({
                ok: true,
                displayName: state.profile?.displayName ?? state.user?.email ?? ''
              })
            )
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(
              JSON.stringify({
                ok: false,
                message: err instanceof Error ? err.message : 'Could not reset password.'
              })
            )
          }
        })()
      })
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    res.end(RECOVERY_HTML)
  })

  server.on('error', () => {
    // Ignore EADDRINUSE if another local process is already listening on port 3000
  })

  server.listen(port, '127.0.0.1')
  return server
}
