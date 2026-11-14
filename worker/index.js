import { Hono } from 'hono';
import { exigirAcesso } from './acesso.js';
import { eu } from './rotas/eu.js';

export function criarApp(opcoes = {}) {
  const app = new Hono();

  // Pública de propósito: só diz que o servidor está de pé, sem dado nenhum.
  app.get('/api/saude', (c) => c.json({ ok: true }));

  // Tudo o mais em /api exige o login do Access.
  app.use('/api/*', exigirAcesso(opcoes));
  app.route('/api', eu);

  return app;
}

export default criarApp();
