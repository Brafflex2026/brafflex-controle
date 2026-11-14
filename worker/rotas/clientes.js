import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, isNull, desc } from 'drizzle-orm';
import { cliente } from '../db/schema.js';
import { gravarComAuditoria } from '../db/auditoria.js';
import { verificarCampos } from '../barreira.js';

export const clientes = new Hono();

const TEXTOS = ['profissao', 'conselho', 'registroUf', 'registroNumero', 'rqe'];
const LIMITE_TEXTO = 120;
const ROTULOS = {
  profissao: 'profissão',
  conselho: 'conselho',
  registroUf: 'UF do registro',
  registroNumero: 'número do registro',
  rqe: 'RQE',
  saude: 'área da saúde',
};

// Pendência = campo desconhecido (NULL). Texto vazio = "não se aplica". RQE só pende na área da saúde.
export function pendencias(c) {
  const lista = ['profissao', 'conselho', 'registroUf', 'registroNumero', 'saude'].filter((k) => c[k] === null);
  if (c.saude === 'sim' && c.rqe === null) lista.push('rqe');
  return lista;
}

const completo = (c) => ({ ...c, pendencias: pendencias(c) });
const resumo = (c) => ({ ...c, totalPendencias: pendencias(c).length });

function erro422(c, campo, mensagem, motivo) {
  return c.json({ erro: mensagem, campo, ...(motivo ? { motivo } : {}) }, 422);
}

// Valida o corpo. `parcial` = edição: só confere o que veio.
function validar(corpo, parcial) {
  const saida = {};
  const tem = (k) => Object.prototype.hasOwnProperty.call(corpo, k);

  if (!parcial || tem('nome')) {
    const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
    if (!nome || nome.length > LIMITE_TEXTO) return { falha: ['nome', 'informe um nome com até 120 caracteres'] };
    saida.nome = nome;
  }
  if (!parcial || tem('tipo')) {
    if (!['pessoa', 'empresa'].includes(corpo.tipo)) return { falha: ['tipo', 'escolha pessoa ou empresa'] };
    saida.tipo = corpo.tipo;
  }
  if (tem('saude')) {
    if (corpo.saude !== null && !['sim', 'nao'].includes(corpo.saude)) return { falha: ['saude', 'escolha sim, não ou deixe a confirmar'] };
    saida.saude = corpo.saude;
  }
  for (const k of TEXTOS) {
    if (!tem(k)) continue;
    const v = corpo[k];
    if (v === null) {
      saida[k] = null;
      continue;
    }
    if (typeof v !== 'string' || v.trim().length > LIMITE_TEXTO) return { falha: [k, `${ROTULOS[k]}: use até 120 caracteres`] };
    saida[k] = v.trim();
  }
  const barrado = verificarCampos(saida);
  if (barrado) return { falha: [barrado.campo, `Dado sensível em "${barrado.campo}": ${barrado.motivo}.`, barrado.motivo] };
  return { dados: saida };
}

clientes.get('/clientes', async (c) => {
  const db = drizzle(c.env.DB);
  const consulta = db.select().from(cliente);
  const linhas = await (c.req.query('arquivados') === '1' ? consulta : consulta.where(isNull(cliente.arquivadoEm))).orderBy(desc(cliente.criadoEm));
  return c.json(linhas.map(resumo));
});

clientes.get('/clientes/:id', async (c) => {
  const [linha] = await drizzle(c.env.DB).select().from(cliente).where(eq(cliente.id, c.req.param('id')));
  return linha ? c.json(completo(linha)) : c.json({ erro: 'cliente não encontrado' }, 404);
});

clientes.post('/clientes', async (c) => {
  const chave = c.req.header('idempotency-key');
  if (!chave || chave.length > 100) return c.json({ erro: 'falta a chave de envio (Idempotency-Key)' }, 400);

  const db = drizzle(c.env.DB);
  const [repetido] = await db.select().from(cliente).where(eq(cliente.chave, chave));
  if (repetido) return c.json(completo(repetido), 200);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const v = validar(corpo, false);
  if (v.falha) return erro422(c, ...v.falha);

  const usuario = c.get('usuario');
  const id = crypto.randomUUID();
  const novo = {
    id,
    chave,
    profissao: null,
    conselho: null,
    registroUf: null,
    registroNumero: null,
    rqe: null,
    saude: null,
    desde: new Date().toISOString().slice(0, 10),
    arquivadoEm: null,
    ...v.dados,
  };
  try {
    await gravarComAuditoria(
      db,
      { usuario: usuario.email, acao: 'criar', entidade: 'cliente', entidadeId: id, antes: null, depois: v.dados },
      db.insert(cliente).values(novo),
    );
  } catch (e) {
    // Dois envios simultâneos com a mesma chave: o segundo cai aqui; devolve o que o primeiro criou.
    const [jaCriado] = await db.select().from(cliente).where(eq(cliente.chave, chave));
    if (jaCriado) return c.json(completo(jaCriado), 200);
    throw e;
  }
  const [criado] = await db.select().from(cliente).where(eq(cliente.id, id));
  return c.json(completo(criado), 201);
});

clientes.patch('/clientes/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const [atual] = await db.select().from(cliente).where(eq(cliente.id, id));
  if (!atual) return c.json({ erro: 'cliente não encontrado' }, 404);

  const corpo = (await c.req.json().catch(() => null)) ?? {};
  const v = validar(corpo, true);
  if (v.falha) return erro422(c, ...v.falha);

  const antes = Object.fromEntries(Object.keys(v.dados).map((k) => [k, atual[k]]));
  const mudanca = { ...v.dados, atualizadoEm: new Date().toISOString() };
  await gravarComAuditoria(
    db,
    { usuario: c.get('usuario').email, acao: 'alterar', entidade: 'cliente', entidadeId: id, antes, depois: v.dados },
    db.update(cliente).set(mudanca).where(eq(cliente.id, id)),
  );
  const [novo] = await db.select().from(cliente).where(eq(cliente.id, id));
  return c.json(completo(novo));
});

async function mudarArquivo(c, arquivar) {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const [atual] = await db.select().from(cliente).where(eq(cliente.id, id));
  if (!atual) return c.json({ erro: 'cliente não encontrado' }, 404);
  const arquivadoEm = arquivar ? new Date().toISOString() : null;
  await gravarComAuditoria(
    db,
    {
      usuario: c.get('usuario').email,
      acao: arquivar ? 'arquivar' : 'restaurar',
      entidade: 'cliente',
      entidadeId: id,
      antes: { arquivadoEm: atual.arquivadoEm },
      depois: { arquivadoEm },
    },
    db.update(cliente).set({ arquivadoEm, atualizadoEm: new Date().toISOString() }).where(eq(cliente.id, id)),
  );
  const [novo] = await db.select().from(cliente).where(eq(cliente.id, id));
  return c.json(completo(novo));
}

clientes.post('/clientes/:id/arquivar', (c) => mudarArquivo(c, true));
clientes.post('/clientes/:id/restaurar', (c) => mudarArquivo(c, false));
