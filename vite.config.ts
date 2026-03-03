import { defineConfig, type ViteDevServer } from 'vite';

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
      name: 'lobby-ws',
      configureServer(server: ViteDevServer) {
        server.httpServer?.once('listening', () => {
          import('./server/lobbyServer').then(({ attachLobby }) => {
            if (server.httpServer) {
              attachLobby(server.httpServer);
              console.log('[Lobby] WebSocket server attached at /lobby-ws');
            }
          });
        });
      },
    },
  ],
});
