import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'

function apiDevPlugin() {
  // Parse .env so serverless functions get RESEND_API_KEY etc.
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    });
  }

  return {
    name: 'api-dev',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        const fnName = (req.url ?? '/').replace(/^\//, '').split('?')[0] || 'index';
        const fnPath = path.resolve(`api/${fnName}.js`);

        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }

          const mockRes = {
            _done: false,
            status(code) { res.statusCode = code; return this; },
            json(data) {
              if (this._done) return;
              this._done = true;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
            },
          };

          try {
            const { default: handler } = await import(pathToFileURL(fnPath).href);
            await handler(req, mockRes);
          } catch (err) {
            if (!res.writableEnded) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDevPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), './src'),
    },
  },
});