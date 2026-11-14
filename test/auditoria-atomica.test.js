import { env } from 'cloudflare:test';
import { it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { usuario, auditoriaApp } from '../worker/db/schema.js';
import { gravarComAuditoria } from '../worker/db/auditoria.js';

it('se a mudança falha, nenhuma auditoria é gravada', async () => {
  const db = drizzle(env.DB);
  await db.insert(usuario).values({ email: 'teste-dup@exemplo.com', nome: 'TESTE-DUP', papel: 'rodrigo' });
  const antes = (await db.select().from(auditoriaApp)).length;
  await expect(
    gravarComAuditoria(
      db,
      { usuario: 'teste-dup@exemplo.com', acao: 'criar', entidade: 'usuario', entidadeId: 'teste-dup@exemplo.com', depois: {} },
      db.insert(usuario).values({ email: 'teste-dup@exemplo.com', nome: 'REPETIDO', papel: 'rodrigo' }),
    ),
  ).rejects.toThrow();
  expect((await db.select().from(auditoriaApp)).length).toBe(antes);
});
