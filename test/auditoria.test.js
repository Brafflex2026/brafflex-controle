import { env } from 'cloudflare:test';
import { it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { usuario, auditoriaApp } from '../worker/db/schema.js';
import { gravarComAuditoria } from '../worker/db/auditoria.js';

it('a mudança e a auditoria são gravadas juntas', async () => {
  const db = drizzle(env.DB);
  await db.insert(usuario).values({ email: 'teste-a@exemplo.com', nome: 'TESTE-A', papel: 'rodrigo' });
  await gravarComAuditoria(
    db,
    {
      usuario: 'teste-a@exemplo.com',
      acao: 'alterar',
      entidade: 'usuario',
      entidadeId: 'teste-a@exemplo.com',
      antes: { nome: 'TESTE-A' },
      depois: { nome: 'TESTE-B' },
    },
    db.update(usuario).set({ nome: 'TESTE-B' }).where(eq(usuario.email, 'teste-a@exemplo.com')),
  );
  const [u] = await db.select().from(usuario).where(eq(usuario.email, 'teste-a@exemplo.com'));
  const log = await db.select().from(auditoriaApp);
  expect(u.nome).toBe('TESTE-B');
  expect(log).toHaveLength(1);
  expect(JSON.parse(log[0].depois)).toEqual({ nome: 'TESTE-B' });
});
