import { Hono } from 'hono';
import { exigirAcesso } from './acesso.js';
import { eu } from './rotas/eu.js';
import { clientes } from './rotas/clientes.js';
import { contratos } from './rotas/contratos.js';
import { briefings } from './rotas/briefings.js';

export function criarApp(opcoes = {}) {
  const app = new Hono();

  // Pública de propósito: só diz que o servidor está de pé, sem dado nenhum.
  app.get('/api/saude', (c) => c.json({ ok: true }));

  // Tudo o mais em /api exige o login do Access.
  app.use('/api/*', exigirAcesso(opcoes));
  app.route('/api', eu);
  app.route('/api', clientes);
  app.route('/api', contratos);
  app.route('/api', briefings);

  return app;
}

export default criarApp();
