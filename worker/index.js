import { Hono } from 'hono';
import { exigirAcesso } from './acesso.js';
import { eu } from './rotas/eu.js';
import { clientes } from './rotas/clientes.js';
import { contratos } from './rotas/contratos.js';
import { briefings } from './rotas/briefings.js';
import { integracoes } from './rotas/integracoes.js';
import { auditoria } from './rotas/auditoria.js';
import { trilha } from './rotas/trilha.js';
import { demandas } from './rotas/demandas.js';

export function criarApp(opcoes = {}) {
  const app = new Hono();

  // Erro inesperado: registra só o tipo (a mensagem de banco pode trazer o texto que a pessoa enviou) e responde genérico.
  app.onError((e, c) => {
    console.error('erro interno', e?.name ?? 'Erro');
    return c.json({ erro: 'erro interno; tente de novo' }, 500);
  });

  // Pública de propósito: só diz que o servidor está de pé, sem dado nenhum.
  app.get('/api/saude', (c) => c.json({ ok: true }));

  // Tudo o mais em /api exige o login do Access.
  app.use('/api/*', exigirAcesso(opcoes));
  app.route('/api', eu);
  app.route('/api', clientes);
  app.route('/api', contratos);
  app.route('/api', briefings);
  app.route('/api', integracoes);
  app.route('/api', auditoria);
  app.route('/api', trilha);
  app.route('/api', demandas);

  return app;
}

export default criarApp();
