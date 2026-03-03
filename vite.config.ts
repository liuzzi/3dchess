import { defineConfig, type ViteDevServer } from 'vite';
import httpProxy from 'http-proxy';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
  },
  server: {
    host: true,
  },
  plugins: [
    {
      name: 'lobby-ws-proxy',
      configureServer(server: ViteDevServer) {
        // Proxy local /lobby-ws requests to the local PartyKit dev server
        const proxy = httpProxy.createProxyServer({
          target: 'http://127.0.0.1:1999/parties/main/global-lobby',
          ws: true,
          ignorePath: true, // Crucial: strips /lobby-ws and replaces it with the target path
        });

        // Add error handler to prevent proxy crashes from killing the Vite dev server
        proxy.on('error', (err, req, res) => {
          console.error('[Lobby Proxy Error]', err.message);
          // If the user hasn't started the partykit dev server yet:
          if ((err as any).code === 'ECONNREFUSED') {
            console.error('Make sure to run `npm run party` in another terminal!');
          }
          if (res && 'writeHead' in res) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Proxy error: ' + err.message);
          }
        });

        server.middlewares.use((req, res, next) => {
          if (req.url === '/lobby-ws') {
            proxy.web(req, res);
          } else {
            next();
          }
        });

        server.httpServer?.on('upgrade', (req, socket, head) => {
          if (req.url === '/lobby-ws') {
            proxy.ws(req, socket, head);
          }
        });
      },
    },
  ],
});

