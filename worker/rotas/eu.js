import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { usuario } from '../db/schema.js';
import { gravarComAuditoria } from '../db/auditoria.js';
import { verificarCampos } from '../barreira.js';

export const eu = new Hono();

const publico = (u) => ({ email: u.email, nome: u.nome, papel: u.papel });

eu.get('/eu', (c) => c.json(publico(c.get('usuario'))));

eu.patch('/eu', async (c) => {
  const atual = c.get('usuario');
  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
  if (!nome || nome.length > 120) {
    return c.json({ erro: 'informe um nome com até 120 caracteres', campo: 'nome' }, 422);
  }
  const barrado = verificarCampos({ nome });
  if (barrado) {
    return c.json({ erro: `Dado sensível em "nome": ${barrado.motivo}.`, campo: 'nome', motivo: barrado.motivo }, 422);
  }
  const db = drizzle(c.env.DB);
  await gravarComAuditoria(
    db,
    {
      usuario: atual.email,
      acao: 'alterar',
      entidade: 'usuario',
      entidadeId: atual.email,
      antes: { nome: atual.nome },
      depois: { nome },
    },
    db.update(usuario).set({ nome }).where(eq(usuario.email, atual.email)),
  );
  return c.json(publico({ ...atual, nome }));
});
