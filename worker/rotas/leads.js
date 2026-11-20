import { Hono } from 'hono';
import { verificarTexto } from '../barreira.js';
import { mudarComAuditoria } from '../db/transicao.js';
import { sha256 } from '../hash.js';

export const leads = new Hono();

export const ORIGENS = [
  'Google Maps (API)', 'site ou Instagram público', 'formulário com consentimento', 'grupo de WhatsApp', 'indicação',
  'rede de contatos', 'evento', 'anúncio com formulário', 'contato direto',
];
export const BASES_LEGAIS = ['legítimo interesse', 'consentimento', 'procura do próprio lead'];
export const MOTIVOS_PERDA = ['sem resposta', 'sem interesse', 'já tem solução', 'preço', 'fora do perfil', 'momento errado', 'outro'];
const FAIXAS = ['Quente', 'Morno', 'Frio'];
// Regra 9.5 do desenho do CRM: contato tirado de grupo de WhatsApp não entra até a base legal estar registrada (pendência do Rodrigo).
// Para liberar, basta tirar 'grupo de WhatsApp' desta lista.
const ORIGENS_BLOQUEADAS = ['grupo de WhatsApp'];

const LIMITE_LISTA = 500;
export const PLACE_ID = /^(ChIJ|GhIJ)[A-Za-z0-9_-]{15,100}$/;
const CAMPOS = new Set(['funilId', 'empresa', 'contato', 'telefone', 'placeId', 'nota', 'faixa', 'origem', 'baseLegal', 'consentimentoEm', 'consentimentoComo', 'responsavel', 'observacoes', 'proximoPasso', 'proximoPassoEm']);
const COLUNA = {
  empresa: 'empresa', contato: 'contato', telefone: 'telefone', placeId: 'place_id', nota: 'nota', faixa: 'faixa', origem: 'origem', baseLegal: 'base_legal',
  consentimentoEm: 'consentimento_em', consentimentoComo: 'consentimento_como', responsavel: 'responsavel', observacoes: 'observacoes',
  proximoPasso: 'proximo_passo', proximoPassoEm: 'proximo_passo_em',
};
// Dado pessoal: o valor nunca vai para a auditoria (ela é só de acréscimo e não poderia ser apagada no opt-out).
const SENSIVEIS = new Set(['telefone', 'contato']);
const TEXTOS = {
  empresa: ['empresa', 200], contato: ['contato', 120], consentimentoComo: ['como foi dado o consentimento', 300],
  responsavel: ['responsável', 120], observacoes: ['observações', 1000], proximoPasso: ['próximo passo', 300],
};

const objetoSimples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (c, campo, erro, motivo) => c.json({ erro, campo, ...(motivo ? { motivo } : {}) }, 422);
const hojeEmBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const agora = () => new Date().toISOString();

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  const ano = Number(s.slice(0, 4));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && ano >= 2020 && ano <= 2100;
}

// Telefone brasileiro: só dígitos, DDD + número (10 ou 11 dígitos). Tira pontuação e o código 55.
export function normalizarTelefone(v) {
  if (typeof v !== 'string' || /[A-Za-z]/.test(v)) return null;
  let d = v.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (!/^[1-9][1-9](\d{8}|9\d{8})$/.test(d)) return null;
  return d;
}

const semAlterar = (c) => c.json({ erro: 'o lead não é apagado nem substituído; mude o estágio ou edite os campos' }, 405, { Allow: 'GET, PATCH' });
leads.on(['PUT', 'DELETE'], '/leads/:id', semAlterar);
leads.on(['PUT', 'DELETE'], '/leads', semAlterar);

// Valida o que veio no corpo. Devolve { dados } (campo -> valor já limpo, null = vazio) ou { falha: [campo, mensagem, motivo?] }.
export function validar(corpo) {
  const dados = {};
  const tem = (k) => Object.prototype.hasOwnProperty.call(corpo, k);
  const vazio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

  for (const [campo, [rotulo, max]] of Object.entries(TEXTOS)) {
    if (!tem(campo)) continue;
    const v = corpo[campo];
    if (vazio(v)) { dados[campo] = null; continue; }
    if (typeof v !== 'string') return { falha: [campo, `${rotulo}: envie texto`] };
    const t = v.trim();
    if (t.length > max) return { falha: [campo, `${rotulo}: use até ${max} caracteres`] };
    const barrado = verificarTexto(t);
    if (barrado) {
      const dica = campo === 'contato' ? ' Para o telefone, use o campo próprio.' : '';
      return { falha: [campo, `Dado sensível em "${rotulo}": ${barrado.motivo}.${dica}`, barrado.motivo] };
    }
    dados[campo] = t;
  }
  if (tem('telefone')) {
    if (vazio(corpo.telefone)) dados.telefone = null;
    else {
      const t = normalizarTelefone(corpo.telefone);
      if (!t) return { falha: ['telefone', 'telefone: informe DDD + número (10 ou 11 dígitos)'] };
      dados.telefone = t;
    }
  }
  if (tem('placeId')) {
    if (vazio(corpo.placeId)) dados.placeId = null;
    else if (typeof corpo.placeId !== 'string' || !PLACE_ID.test(corpo.placeId.trim())) return { falha: ['placeId', 'Place ID: use o código do Google Maps (começa com ChIJ)'] };
    else dados.placeId = corpo.placeId.trim();
  }
  if (tem('nota')) {
    if (corpo.nota === null) dados.nota = null;
    else if (!Number.isInteger(corpo.nota) || corpo.nota < 0 || corpo.nota > 100) return { falha: ['nota', 'nota: número inteiro de 0 a 100'] };
    else dados.nota = corpo.nota;
  }
  if (tem('faixa')) {
    if (vazio(corpo.faixa)) dados.faixa = null;
    else if (!FAIXAS.includes(corpo.faixa)) return { falha: ['faixa', `faixa: ${FAIXAS.join(', ')}`] };
    else dados.faixa = corpo.faixa;
  }
  if (tem('origem')) {
    if (!ORIGENS.includes(corpo.origem)) return { falha: ['origem', `origem: escolha uma da lista (${ORIGENS.join('; ')})`] };
    if (ORIGENS_BLOQUEADAS.includes(corpo.origem)) return { falha: ['origem', `Contato de ${corpo.origem} não entra até a base legal dessa origem ser registrada pelo Rodrigo.`] };
    dados.origem = corpo.origem;
  }
  if (tem('baseLegal')) {
    if (!BASES_LEGAIS.includes(corpo.baseLegal)) return { falha: ['baseLegal', `base legal: escolha uma da lista (${BASES_LEGAIS.join('; ')})`] };
    dados.baseLegal = corpo.baseLegal;
  }
  for (const campo of ['consentimentoEm', 'proximoPassoEm']) {
    if (!tem(campo)) continue;
    if (vazio(corpo[campo])) { dados[campo] = null; continue; }
    if (!dataValida(corpo[campo])) return { falha: [campo, 'informe uma data real no formato AAAA-MM-DD'] };
    if (campo === 'consentimentoEm' && corpo[campo] > hojeEmBrasilia()) return { falha: [campo, 'a data do consentimento não pode ser no futuro'] };
    dados[campo] = corpo[campo];
  }
  return { dados };
}

const SELECAO = `l.*, e.nome AS estagio_nome, e.final AS final, e.ordem AS estagio_ordem`;
const FROM = 'FROM lead l JOIN estagio e ON e.id = l.estagio_id';
const VENCIDO = "(l.proximo_passo_em IS NOT NULL AND l.proximo_passo_em < ? AND (e.final IS NULL OR e.final = 'Nutrir'))";

const resumo = (r, hoje) => ({
  id: r.id, funilId: r.funil_id, estagioId: r.estagio_id, estagioNome: r.estagio_nome, final: r.final, empresa: r.empresa,
  nota: r.nota, faixa: r.faixa, origem: r.origem, responsavel: r.responsavel, proximoPasso: r.proximo_passo, proximoPassoEm: r.proximo_passo_em,
  ultimoContatoEm: r.ultimo_contato_em, estagioDesde: r.estagio_desde,
  vencido: !!(r.proximo_passo_em && r.proximo_passo_em < hoje && (!r.final || r.final === 'Nutrir')),
});
const completo = (r, hoje) => ({
  ...resumo(r, hoje), contato: r.contato, telefone: r.telefone, placeId: r.place_id, baseLegal: r.base_legal, consentimentoEm: r.consentimento_em,
  consentimentoComo: r.consentimento_como, ultimoContatoCanal: r.ultimo_contato_canal, motivoPerda: r.motivo_perda, observacoes: r.observacoes,
  criadoEm: r.criado_em, atualizadoEm: r.atualizado_em, criadoPor: r.criado_por,
  optOutEm: r.opt_out_em, clienteId: r.cliente_id, contatoApagadoEm: r.contato_apagado_em,
});

const buscar = (DB, id) => DB.prepare(`SELECT ${SELECAO} ${FROM} WHERE l.id = ?`).bind(id).first();

// Descobre qual chave de duplicata já está em uso (e por qual lead), sem devolver o valor.
async function acharDuplicata(DB, { telefone, placeId }, ignorar = null) {
  // Quem pediu para sair (opt-out) não volta: confere a lista de hashes antes de olhar os leads.
  for (const [campo, valor, tipo] of [['telefone', telefone, 'telefone'], ['placeId', placeId, 'place_id']]) {
    if (!valor) continue;
    if (await DB.prepare('SELECT 1 AS x FROM contato_bloqueado WHERE hash = ? AND tipo = ?').bind(await sha256(valor), tipo).first()) return { campo, optOut: true };
  }
  if (telefone) {
    const r = await DB.prepare('SELECT id FROM lead WHERE telefone = ? AND id IS NOT ?').bind(telefone, ignorar).first();
    if (r) return { campo: 'telefone', leadId: r.id };
  }
  if (placeId) {
    const r = await DB.prepare('SELECT id FROM lead WHERE place_id = ? AND id IS NOT ?').bind(placeId, ignorar).first();
    if (r) return { campo: 'placeId', leadId: r.id };
  }
  return null;
}
const respostaDuplicata = (c, d) => d.optOut
  ? c.json({ erro: `este ${d.campo === 'telefone' ? 'telefone' : 'Place ID'} pertence a quem pediu para não ser contatado; não pode ser cadastrado de novo`, campo: d.campo, optOut: true }, 409)
  : c.json({ erro: d.campo === 'telefone' ? 'já existe um lead com este telefone' : 'já existe um lead com este Place ID', campo: d.campo, leadId: d.leadId }, 409);

function regraConsentimento(d) {
  if (d.baseLegal === 'consentimento' && (!d.consentimentoEm || !d.consentimentoComo)) {
    return ['consentimentoEm', 'com a base legal "consentimento", informe a data e como o consentimento foi dado'];
  }
  return null;
}

// ---------------------------------------------------------------- funis
leads.get('/funis', async (c) => {
  const [f, e] = await Promise.all([
    c.env.DB.prepare('SELECT id, nome FROM funil ORDER BY nome').all(),
    c.env.DB.prepare('SELECT id, funil_id, ordem, nome, final FROM estagio ORDER BY funil_id, ordem').all(),
  ]);
  return c.json({
    itens: f.results.map((x) => ({ ...x, estagios: e.results.filter((s) => s.funil_id === x.id).map((s) => ({ id: s.id, ordem: s.ordem, nome: s.nome, final: s.final })) })),
    origens: ORIGENS.map((o) => ({ nome: o, bloqueada: ORIGENS_BLOQUEADAS.includes(o) })),
    basesLegais: BASES_LEGAIS,
    motivosPerda: MOTIVOS_PERDA,
  });
});

// ---------------------------------------------------------------- lista e detalhe
leads.get('/leads', async (c) => {
  const q = c.req.query();
  const hoje = hojeEmBrasilia();
  const onde = [];
  const binds = [];
  if (q.funil) { onde.push('l.funil_id = ?'); binds.push(q.funil.slice(0, 50)); }
  if (q.q) { onde.push('instr(lower(l.empresa), lower(?)) > 0'); binds.push(q.q.slice(0, 100)); }
  if (q.responsavel) { onde.push("instr(lower(coalesce(l.responsavel, '')), lower(?)) > 0"); binds.push(q.responsavel.slice(0, 120)); }
  const base = onde.length ? `WHERE ${onde.join(' AND ')}` : '';
  const lista = [...onde];
  const bindsLista = [...binds];
  if (q.estagio) { lista.push('l.estagio_id = ?'); bindsLista.push(q.estagio.slice(0, 50)); }
  if (q.vencidos === '1') { lista.push(VENCIDO); bindsLista.push(hoje); }
  const filtro = lista.length ? `WHERE ${lista.join(' AND ')}` : '';

  const DB = c.env.DB;
  const [itens, contagem, vencidos, sem] = await Promise.all([
    DB.prepare(`SELECT ${SELECAO} ${FROM} ${filtro} ORDER BY l.criado_em DESC LIMIT ${LIMITE_LISTA}`).bind(...bindsLista).all(),
    DB.prepare(`SELECT l.estagio_id AS id, COUNT(*) AS total ${FROM} ${base} GROUP BY l.estagio_id`).bind(...binds).all(),
    DB.prepare(`SELECT COUNT(*) AS total ${FROM} ${base ? `${base} AND` : 'WHERE'} ${VENCIDO}`).bind(...binds, hoje).first(),
    DB.prepare(`SELECT COUNT(*) AS total ${FROM} ${base ? `${base} AND` : 'WHERE'} e.final IS NULL AND l.proximo_passo_em IS NULL`).bind(...binds).first(),
  ]);
  return c.json({
    itens: itens.results.map((r) => resumo(r, hoje)),
    contagens: Object.fromEntries(contagem.results.map((r) => [r.id, r.total])),
    vencidos: vencidos.total,
    semProximoPasso: sem.total,
  });
});

leads.get('/leads/:id', async (c) => {
  const r = await buscar(c.env.DB, c.req.param('id'));
  if (!r) return c.json({ erro: 'lead não encontrado' }, 404);
  const eventos = (await c.env.DB.prepare('SELECT id, ts, tipo, de, para, canal, nota, usuario FROM lead_evento WHERE lead_id = ? ORDER BY id').bind(r.id).all()).results;
  return c.json({ lead: completo(r, hojeEmBrasilia()), eventos });
});

// ---------------------------------------------------------------- criar
leads.post('/leads', async (c) => {
  const chave = c.req.header('idempotency-key');
  if (!chave || chave.length > 100) return c.json({ erro: 'falta a chave de envio (Idempotency-Key)' }, 400);
  const DB = c.env.DB;
  const hoje = hojeEmBrasilia();

  const repetido = await DB.prepare(`SELECT ${SELECAO} ${FROM} WHERE l.chave = ?`).bind(chave).first();
  if (repetido) return c.json({ lead: completo(repetido, hoje) }, 200);

  const corpo = await c.req.json().catch(() => null);
  if (!objetoSimples(corpo)) return falha(c, 'corpo', 'envie os dados do lead');
  for (const k of Object.keys(corpo)) if (!CAMPOS.has(k)) return falha(c, k, `"${k}" não pode ser informado`);

  const funil = typeof corpo.funilId === 'string' ? await DB.prepare('SELECT id FROM funil WHERE id = ?').bind(corpo.funilId).first() : null;
  if (!funil) return falha(c, 'funilId', 'funil: escolha Ravclin, Etiqueteria ou Brafflex');
  if (typeof corpo.empresa !== 'string' || corpo.empresa.trim() === '') return falha(c, 'empresa', 'empresa: preencha o nome');
  if (corpo.origem === undefined || corpo.origem === null) return falha(c, 'origem', 'origem: obrigatória');
  if (corpo.baseLegal === undefined || corpo.baseLegal === null) return falha(c, 'baseLegal', 'base legal: obrigatória');

  const v = validar(corpo);
  if (v.falha) return falha(c, ...v.falha);
  const d = v.dados;
  const regra = regraConsentimento(d);
  if (regra) return falha(c, ...regra);

  const dup = await acharDuplicata(DB, d);
  if (dup) return respostaDuplicata(c, dup);

  const primeiro = await DB.prepare('SELECT id, nome FROM estagio WHERE funil_id = ? ORDER BY ordem LIMIT 1').bind(funil.id).first();
  const id = crypto.randomUUID();
  const ts = agora();
  const usuario = c.get('usuario').email;
  try {
    await DB.batch([
      DB.prepare(
        `INSERT INTO lead (id, chave, funil_id, estagio_id, estagio_desde, empresa, contato, telefone, place_id, nota, faixa, origem, base_legal, consentimento_em, consentimento_como,
           proximo_passo, proximo_passo_em, responsavel, observacoes, criado_em, atualizado_em, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, chave, funil.id, primeiro.id, ts, d.empresa, d.contato ?? null, d.telefone ?? null, d.placeId ?? null, d.nota ?? null, d.faixa ?? null, d.origem, d.baseLegal,
        d.consentimentoEm ?? null, d.consentimentoComo ?? null, d.proximoPasso ?? null, d.proximoPassoEm ?? null, d.responsavel ?? null, d.observacoes ?? null, ts, ts, usuario,
      ),
      DB.prepare("INSERT INTO lead_evento (lead_id, ts, tipo, de, para, canal, nota, usuario) VALUES (?, ?, 'criacao', NULL, ?, NULL, NULL, ?)").bind(id, ts, primeiro.nome, usuario),
      DB.prepare("INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) VALUES (?, ?, 'criar', 'lead', ?, NULL, ?)").bind(
        ts, usuario, id, JSON.stringify({ funilId: funil.id, empresa: d.empresa, origem: d.origem, baseLegal: d.baseLegal, nota: d.nota ?? null, faixa: d.faixa ?? null }),
      ),
    ]);
  } catch (e) {
    const ja = await DB.prepare(`SELECT ${SELECAO} ${FROM} WHERE l.chave = ?`).bind(chave).first();
    if (ja) return c.json({ lead: completo(ja, hoje) }, 200);
    const dup2 = await acharDuplicata(DB, d);
    if (dup2) return respostaDuplicata(c, dup2);
    throw e;
  }
  return c.json({ lead: completo(await buscar(DB, id), hoje) }, 201);
});

// ---------------------------------------------------------------- editar
leads.patch('/leads/:id', async (c) => {
  const DB = c.env.DB;
  const hoje = hojeEmBrasilia();
  const atual = await buscar(DB, c.req.param('id'));
  if (!atual) return c.json({ erro: 'lead não encontrado' }, 404);
  if (atual.opt_out_em) return c.json({ erro: 'este lead pediu para não ser contatado: os dados dele não são mais editados' }, 409);

  const corpo = await c.req.json().catch(() => null);
  if (!objetoSimples(corpo)) return falha(c, 'corpo', 'envie os campos a alterar');
  for (const k of Object.keys(corpo)) if (!CAMPOS.has(k) || k === 'funilId') return falha(c, k, `"${k}" não pode ser alterado aqui`);
  for (const k of ['origem', 'baseLegal', 'empresa']) {
    if (Object.prototype.hasOwnProperty.call(corpo, k) && (corpo[k] === null || corpo[k] === '' || corpo[k] === undefined)) return falha(c, k, `${k === 'baseLegal' ? 'base legal' : k}: não pode ficar vazio`);
  }
  const v = validar(corpo);
  if (v.falha) return falha(c, ...v.falha);

  const mudou = Object.keys(v.dados).filter((campo) => v.dados[campo] !== atual[COLUNA[campo]]);
  if (mudou.length === 0) return c.json({ lead: completo(atual, hoje) });

  const merged = {
    baseLegal: v.dados.baseLegal ?? atual.base_legal,
    consentimentoEm: 'consentimentoEm' in v.dados ? v.dados.consentimentoEm : atual.consentimento_em,
    consentimentoComo: 'consentimentoComo' in v.dados ? v.dados.consentimentoComo : atual.consentimento_como,
  };
  const regra = regraConsentimento(merged);
  if (regra) return falha(c, ...regra);

  const dup = await acharDuplicata(DB, { telefone: mudou.includes('telefone') ? v.dados.telefone : null, placeId: mudou.includes('placeId') ? v.dados.placeId : null }, atual.id);
  if (dup) return respostaDuplicata(c, dup);

  const visiveis = mudou.filter((k) => !SENSIVEIS.has(k));
  const sensiveis = mudou.filter((k) => SENSIVEIS.has(k));
  let ok;
  try {
    ok = await mudarComAuditoria(DB, {
      tabela: 'lead',
      id: atual.id,
      mudanca: { ...Object.fromEntries(mudou.map((k) => [COLUNA[k], v.dados[k]])), atualizado_em: agora() },
      condicao: 'atualizado_em = ?',
      condicaoBinds: [atual.atualizado_em],
      usuario: c.get('usuario').email,
      acao: 'alterar',
      entidade: 'lead',
      antes: Object.fromEntries(visiveis.map((k) => [k, atual[COLUNA[k]]])),
      depois: { ...Object.fromEntries(visiveis.map((k) => [k, v.dados[k]])), ...(sensiveis.length ? { camposDePessoaAlterados: sensiveis } : {}) },
    });
  } catch (e) {
    const dup2 = await acharDuplicata(DB, { telefone: v.dados.telefone, placeId: v.dados.placeId }, atual.id);
    if (dup2) return respostaDuplicata(c, dup2);
    throw e;
  }
  if (!ok) return c.json({ erro: 'o lead mudou enquanto você editava; recarregue a tela' }, 409);
  return c.json({ lead: completo(await buscar(DB, atual.id), hoje) });
});

// ---------------------------------------------------------------- eventos: mudar de estágio e registrar contato
leads.post('/leads/:id/eventos', async (c) => {
  const DB = c.env.DB;
  const hoje = hojeEmBrasilia();
  const lead = await buscar(DB, c.req.param('id'));
  if (!lead) return c.json({ erro: 'lead não encontrado' }, 404);

  const corpo = await c.req.json().catch(() => null);
  if (!objetoSimples(corpo)) return falha(c, 'corpo', 'envie os dados do evento');
  if (corpo.tipo !== 'estagio' && corpo.tipo !== 'contato') return falha(c, 'tipo', 'tipo: use "estagio" ou "contato"');
  if (lead.opt_out_em && corpo.tipo === 'contato') return c.json({ erro: 'este lead pediu para não ser contatado: não se registra contato' }, 409);
  const permitidos = new Set(['tipo', 'nota', 'proximoPasso', 'proximoPassoEm', ...(corpo.tipo === 'estagio' ? ['estagioId', 'motivoPerda'] : ['canal'])]);
  for (const k of Object.keys(corpo)) if (!permitidos.has(k)) return falha(c, k, `"${k}" não pode ser informado neste tipo de evento`);

  // Nota do evento (barreira) e próximo passo opcional.
  let nota = null;
  if (corpo.nota !== undefined && corpo.nota !== null && String(corpo.nota).trim() !== '') {
    if (typeof corpo.nota !== 'string' || corpo.nota.trim().length > 500) return falha(c, 'nota', 'nota: use até 500 caracteres');
    const barrado = verificarTexto(corpo.nota.trim());
    if (barrado) return falha(c, 'nota', `Dado sensível em "nota": ${barrado.motivo}. Não registre telefone, e-mail nem dado de paciente.`, barrado.motivo);
    nota = corpo.nota.trim();
  }
  const passo = validar({ ...(corpo.proximoPasso !== undefined ? { proximoPasso: corpo.proximoPasso } : {}), ...(corpo.proximoPassoEm !== undefined ? { proximoPassoEm: corpo.proximoPassoEm } : {}) });
  if (passo.falha) return falha(c, ...passo.falha);
  const temPasso = Object.keys(passo.dados).length > 0;

  const ts = agora();
  const usuario = c.get('usuario').email;

  if (corpo.tipo === 'contato') {
    let canal = typeof corpo.canal === 'string' ? corpo.canal.trim() : '';
    if (!canal || canal.length > 60) return falha(c, 'canal', 'canal: informe por onde foi o contato (até 60 caracteres)');
    const barrado = verificarTexto(canal);
    if (barrado) return falha(c, 'canal', `Dado sensível em "canal": ${barrado.motivo}.`, barrado.motivo);
    const sets = ['ultimo_contato_em = ?', 'ultimo_contato_canal = ?', 'atualizado_em = ?'];
    const vals = [ts, canal, ts];
    if ('proximoPasso' in passo.dados) { sets.push('proximo_passo = ?'); vals.push(passo.dados.proximoPasso); }
    if ('proximoPassoEm' in passo.dados) { sets.push('proximo_passo_em = ?'); vals.push(passo.dados.proximoPassoEm); }
    await DB.batch([
      DB.prepare("INSERT INTO lead_evento (lead_id, ts, tipo, de, para, canal, nota, usuario) VALUES (?, ?, 'contato', NULL, NULL, ?, ?, ?)").bind(lead.id, ts, canal, nota, usuario),
      DB.prepare(`UPDATE lead SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, lead.id),
      DB.prepare("INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) VALUES (?, ?, 'registrar_contato', 'lead', ?, NULL, ?)").bind(ts, usuario, lead.id, JSON.stringify({ canal })),
    ]);
    return c.json({ lead: completo(await buscar(DB, lead.id), hoje) }, 201);
  }

  // ---- mudança de estágio
  const dest = typeof corpo.estagioId === 'string' ? await DB.prepare('SELECT id, funil_id, nome, final FROM estagio WHERE id = ?').bind(corpo.estagioId).first() : null;
  if (!dest || dest.funil_id !== lead.funil_id) return falha(c, 'estagioId', 'estágio: escolha um estágio deste funil');
  if (dest.id === lead.estagio_id) return c.json({ erro: 'o lead já está nesse estágio' }, 409);
  if (lead.final === 'Ganho') return c.json({ erro: 'lead ganho não volta para outro estágio' }, 409);
  if (lead.final === 'Não contatar') return c.json({ erro: 'lead que pediu para não ser contatado não muda de estágio' }, 409);
  if (dest.final === 'Não contatar') return c.json({ erro: 'o estágio "Não contatar" só é usado pelo opt-out (pedido do próprio lead para sair): use o botão de opt-out' }, 409);

  let motivo = null;
  if (dest.final === 'Perdido') {
    if (!MOTIVOS_PERDA.includes(corpo.motivoPerda)) return falha(c, 'motivoPerda', `motivo da perda: escolha um (${MOTIVOS_PERDA.join('; ')})`);
    motivo = corpo.motivoPerda;
  } else if (corpo.motivoPerda !== undefined) {
    return falha(c, 'motivoPerda', 'o motivo da perda só vale para o estágio Perdido');
  }
  if (dest.final === 'Nutrir' && !(passo.dados.proximoPassoEm)) return falha(c, 'proximoPassoEm', 'Nutrir: informe a data para retomar o contato');

  const sets = ['estagio_id = ?', 'estagio_desde = ?', 'motivo_perda = ?', 'atualizado_em = ?'];
  const vals = [dest.id, ts, motivo, ts];
  if ('proximoPasso' in passo.dados) { sets.push('proximo_passo = ?'); vals.push(passo.dados.proximoPasso); }
  if ('proximoPassoEm' in passo.dados) { sets.push('proximo_passo_em = ?'); vals.push(passo.dados.proximoPassoEm); }
  // changes() = linhas mexidas pelo comando anterior do lote: o evento só entra se o UPDATE valeu, e a auditoria só se o evento entrou.
  const guarda = 'changes() = 1';
  const r = await DB.batch([
    // Só vale se o lead ainda estiver no estágio (e desde o momento) em que foi lido.
    DB.prepare(`UPDATE lead SET ${sets.join(', ')} WHERE id = ? AND estagio_id = ? AND estagio_desde = ?`).bind(...vals, lead.id, lead.estagio_id, lead.estagio_desde),
    DB.prepare(`INSERT INTO lead_evento (lead_id, ts, tipo, de, para, canal, nota, usuario) SELECT ?, ?, 'estagio', ?, ?, NULL, ?, ? WHERE ${guarda}`).bind(lead.id, ts, lead.estagio_nome, dest.nome, nota, usuario),
    DB.prepare(`INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) SELECT ?, ?, 'mudar_estagio', 'lead', ?, ?, ? WHERE ${guarda}`).bind(
      ts, usuario, lead.id, JSON.stringify({ estagio: lead.estagio_nome }), JSON.stringify({ estagio: dest.nome, ...(motivo ? { motivoPerda: motivo } : {}) }),
    ),
  ]);
  if (r[0].meta.changes !== 1) return c.json({ erro: 'o lead mudou enquanto você agia; recarregue a tela' }, 409);
  return c.json({ lead: completo(await buscar(DB, lead.id), hoje) }, 201);
});

// ---------------------------------------------------------------- opt-out: apaga o contato e guarda só o hash
async function corpoVazio(c) {
  const texto = (await c.req.text()).trim();
  if (!texto) return true;
  try { const j = JSON.parse(texto); return objetoSimples(j) && Object.keys(j).length === 0; } catch { return false; }
}

leads.post('/leads/:id/optout', async (c) => {
  const DB = c.env.DB;
  const hoje = hojeEmBrasilia();
  const lead = await buscar(DB, c.req.param('id'));
  if (!lead) return c.json({ erro: 'lead não encontrado' }, 404);
  if (!(await corpoVazio(c))) return falha(c, 'corpo', 'o opt-out não recebe dados; envie o pedido vazio');
  if (lead.opt_out_em) return c.json({ erro: 'este lead já pediu para sair' }, 409);
  if (lead.final === 'Ganho') return c.json({ erro: 'lead ganho já é cliente; pedido de apagar dado de cliente não passa por aqui' }, 409);

  const dest = await DB.prepare("SELECT id, nome FROM estagio WHERE funil_id = ? AND final = 'Não contatar'").bind(lead.funil_id).first();
  const ts = agora();
  const usuario = c.get('usuario').email;
  const hashes = [];
  if (lead.telefone) hashes.push(['telefone', await sha256(lead.telefone)]);
  if (lead.place_id) hashes.push(['place_id', await sha256(lead.place_id)]);
  const guarda = 'changes() = 1';
  const lancou = 'EXISTS (SELECT 1 FROM lead WHERE id = ? AND opt_out_em = ?)';

  const r = await DB.batch([
    // Só vale se o lead continua exatamente como foi lido (e sem opt-out): é o que garante que o hash é do telefone que de fato foi apagado.
    DB.prepare(
      `UPDATE lead SET estagio_id = ?, estagio_desde = ?, motivo_perda = NULL, telefone = NULL, contato = NULL, place_id = NULL, observacoes = NULL,
         consentimento_como = NULL, proximo_passo = NULL, proximo_passo_em = NULL, opt_out_em = ?, atualizado_em = ?
       WHERE id = ? AND opt_out_em IS NULL AND atualizado_em = ? AND estagio_id = ?`,
    ).bind(dest.id, ts, ts, ts, lead.id, lead.atualizado_em, lead.estagio_id),
    DB.prepare(`INSERT INTO lead_evento (lead_id, ts, tipo, de, para, canal, nota, usuario) SELECT ?, ?, 'estagio', ?, ?, NULL, NULL, ? WHERE ${guarda}`).bind(lead.id, ts, lead.estagio_nome, dest.nome, usuario),
    DB.prepare(`INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) SELECT ?, ?, 'optout', 'lead', ?, ?, ? WHERE ${guarda}`).bind(
      ts, usuario, lead.id, JSON.stringify({ estagio: lead.estagio_nome }), JSON.stringify({ estagio: dest.nome, contatoApagado: true }),
    ),
    ...hashes.map(([tipo, h]) => DB.prepare(`INSERT OR IGNORE INTO contato_bloqueado (hash, tipo, criado_em) SELECT ?, ?, ? WHERE ${lancou}`).bind(h, tipo, ts, lead.id, ts)),
    DB.prepare(`UPDATE lead_evento SET nota = NULL WHERE lead_id = ? AND nota IS NOT NULL AND ${lancou}`).bind(lead.id, lead.id, ts),
  ]);
  if (r[0].meta.changes !== 1) return c.json({ erro: 'o lead mudou enquanto você agia; recarregue a tela' }, 409);
  return c.json({ lead: completo(await buscar(DB, lead.id), hoje) });
});

// ---------------------------------------------------------------- converter lead ganho em cliente
leads.post('/leads/:id/converter', async (c) => {
  const DB = c.env.DB;
  const hoje = hojeEmBrasilia();
  const lead = await buscar(DB, c.req.param('id'));
  if (!lead) return c.json({ erro: 'lead não encontrado' }, 404);

  const texto = (await c.req.text()).trim();
  let corpo = {};
  if (texto) {
    try { corpo = JSON.parse(texto); } catch { return falha(c, 'corpo', 'envie os dados em JSON'); }
    if (!objetoSimples(corpo)) return falha(c, 'corpo', 'envie os dados do cliente');
  }
  for (const k of Object.keys(corpo)) if (k !== 'tipo') return falha(c, k, `"${k}" não pode ser informado`);
  const tipo = corpo.tipo ?? 'empresa';
  if (tipo !== 'pessoa' && tipo !== 'empresa') return falha(c, 'tipo', 'tipo: escolha pessoa ou empresa');

  if (lead.cliente_id) return c.json({ erro: 'este lead já virou cliente', clienteId: lead.cliente_id }, 409);
  if (lead.final !== 'Ganho') return c.json({ erro: 'só lead no estágio Ganho vira cliente' }, 409);
  if (lead.empresa.length > 120) return falha(c, 'empresa', 'o nome do cliente aceita até 120 caracteres: encurte o nome da empresa no lead antes de converter');

  const clienteId = crypto.randomUUID();
  const ts = agora();
  const usuario = c.get('usuario').email;
  const guarda = 'changes() = 1';
  const r = await DB.batch([
    // Só vale se o lead ainda não tem cliente e continua ganho: duas conversões ao mesmo tempo, só uma passa.
    DB.prepare('UPDATE lead SET cliente_id = ?, atualizado_em = ? WHERE id = ? AND cliente_id IS NULL AND estagio_id = ?').bind(clienteId, ts, lead.id, lead.estagio_id),
    DB.prepare(`INSERT INTO cliente (id, chave, nome, tipo, desde, criado_em, atualizado_em) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guarda}`).bind(clienteId, `lead-${lead.id}`, lead.empresa, tipo, hoje, ts, ts),
    DB.prepare(`INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) SELECT ?, ?, 'criar', 'cliente', ?, NULL, ? WHERE ${guarda}`).bind(ts, usuario, clienteId, JSON.stringify({ nome: lead.empresa, tipo })),
    DB.prepare(`INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) SELECT ?, ?, 'converter', 'lead', ?, NULL, ? WHERE ${guarda}`).bind(ts, usuario, lead.id, JSON.stringify({ clienteId })),
  ]);
  if (r[0].meta.changes !== 1) {
    const atual = await buscar(DB, lead.id);
    return c.json({ erro: 'este lead já virou cliente', ...(atual?.cliente_id ? { clienteId: atual.cliente_id } : {}) }, 409);
  }
  return c.json({ lead: completo(await buscar(DB, lead.id), hoje), clienteId }, 201);
});
