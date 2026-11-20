import { Hono } from 'hono';
import { lerCsv } from '../csv.js';
import { sha256 } from '../hash.js';
import { FONTES, mapearLinha } from '../leads-importador.js';
import { ORIGENS } from './leads.js';

export const leadsImportacao = new Hono();

const MAX_ARQUIVO = 300_000;
const MAX_LINHAS = 500;
const LOTE = 25;
const falha = (c, campo, erro, status = 422) => c.json({ erro, campo }, status);

// Consulta "chave IN (...)" em pedaços (o D1 aceita poucas variáveis por comando).
async function existentes(DB, coluna, tabela, valores) {
  const achados = new Set();
  const lista = [...new Set(valores)];
  for (let i = 0; i < lista.length; i += 80) {
    const parte = lista.slice(i, i + 80);
    const { results } = await DB.prepare(`SELECT ${coluna} AS v FROM ${tabela} WHERE ${coluna} IN (${parte.map(() => '?').join(',')})`).bind(...parte).all();
    for (const r of results) achados.add(r.v);
  }
  return achados;
}

// Lê o arquivo e decide, linha por linha, o que aconteceria. Não grava nada.
async function analisar(c) {
  const corpo = await c.req.json().catch(() => null);
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) return { resposta: falha(c, 'corpo', 'envie a fonte e o arquivo') };
  const { fonte, arquivo } = corpo;
  if (!FONTES.includes(fonte)) return { resposta: falha(c, 'fonte', 'fonte: escolha ravclin ou etiqueteria') };
  if (typeof arquivo !== 'string' || arquivo.trim() === '') return { resposta: falha(c, 'arquivo', 'envie o arquivo CSV') };
  if (arquivo.length > MAX_ARQUIVO) return { resposta: falha(c, 'arquivo', 'arquivo grande demais (até 300 KB)', 413) };

  const csv = lerCsv(arquivo);
  if (csv.erro) return { resposta: falha(c, 'arquivo', csv.erro) };
  const tem = (h) => csv.cabecalho.includes(h);
  if (fonte === 'ravclin' && !tem('clinica')) return { resposta: falha(c, 'arquivo', tem('empresa') ? 'este arquivo parece da Etiqueteria; escolha a fonte Etiqueteria' : 'faltou a coluna "Clínica": exporte o banco Leads Ravclin do Notion em CSV') };
  if (fonte === 'etiqueteria' && !tem('empresa')) return { resposta: falha(c, 'arquivo', tem('clinica') ? 'este arquivo parece do Ravclin; escolha a fonte Ravclin' : 'faltou a coluna "Empresa": use a planilha de leads da Etiqueteria em CSV') };
  if (csv.linhas.length === 0) return { resposta: falha(c, 'arquivo', 'o arquivo não tem nenhuma linha de lead') };
  if (csv.linhas.length > MAX_LINHAS) return { resposta: falha(c, 'arquivo', `use até ${MAX_LINHAS} linhas por arquivo (este tem ${csv.linhas.length})`) };

  const DB = c.env.DB;
  const estagios = (await DB.prepare('SELECT id, nome, final FROM estagio WHERE funil_id = ? ORDER BY ordem').bind(fonte).all()).results;
  const origens = ORIGENS;
  const mapeadas = csv.linhas.map((l) => ({ linha: l.n, ...mapearLinha(fonte, l.valores, { estagios, origens }) }));

  // Chaves que o arquivo traz, para conferir de uma vez com o banco e com a lista de bloqueio.
  const tels = mapeadas.map((m) => m.telefone ?? m.lead?.telefone).filter(Boolean);
  const places = mapeadas.map((m) => m.placeId ?? m.lead?.placeId).filter(Boolean);
  const hashTel = new Map(await Promise.all(tels.map(async (t) => [t, await sha256(t)])));
  const hashPlace = new Map(await Promise.all(places.map(async (p) => [p, await sha256(p)])));
  const [leadTel, leadPlace, bloqueados] = await Promise.all([
    existentes(DB, 'telefone', 'lead', tels),
    existentes(DB, 'place_id', 'lead', places),
    existentes(DB, 'hash', 'contato_bloqueado', [...hashTel.values(), ...hashPlace.values()]),
  ]);

  const r = { fonte, totalLinhas: csv.linhas.length, importaveis: 0, duplicados: 0, optOuts: 0, recusadas: [], avisos: [], porEstagio: {}, amostra: [], leads: [], hashes: [] };
  const vistoTel = new Map();
  const vistoPlace = new Map();
  const recusar = (m, motivo) => r.recusadas.push({ linha: m.linha, empresa: m.empresa || '(sem nome)', motivo });

  for (const m of mapeadas) {
    if (m.recusa) { recusar(m, m.recusa); continue; }
    const tel = m.telefone ?? m.lead?.telefone ?? null;
    const place = m.placeId ?? m.lead?.placeId ?? null;

    if (m.optOut) {
      if ((tel && leadTel.has(tel)) || (place && leadPlace.has(place))) { recusar(m, 'pediu para sair (opt-out), mas o telefone ou Place ID já está num lead ativo: registre o opt-out pela tela do lead'); continue; }
      r.optOuts += 1;
      if (tel) r.hashes.push(['telefone', hashTel.get(tel)]);
      if (place) r.hashes.push(['place_id', hashPlace.get(place)]);
      continue;
    }

    if (tel && bloqueados.has(hashTel.get(tel))) { recusar(m, 'este telefone pertence a quem pediu para não ser contatado'); continue; }
    if (place && bloqueados.has(hashPlace.get(place))) { recusar(m, 'este Place ID pertence a quem pediu para não ser contatado'); continue; }
    const igual = (tel && vistoTel.get(tel)) || (place && vistoPlace.get(place));
    if (igual) { recusar(m, `repetida no arquivo (mesmo telefone ou Place ID da linha ${igual})`); continue; }
    if (tel) vistoTel.set(tel, m.linha);
    if (place) vistoPlace.set(place, m.linha);
    if ((tel && leadTel.has(tel)) || (place && leadPlace.has(place))) { r.duplicados += 1; continue; }

    r.importaveis += 1;
    r.leads.push(m);
    r.porEstagio[m.estagio.nome] = (r.porEstagio[m.estagio.nome] ?? 0) + 1;
    if (r.amostra.length < 5) r.amostra.push({ linha: m.linha, empresa: m.empresa, estagio: m.estagio.nome, origem: m.lead.origem });
    for (const a of m.avisos) r.avisos.push({ linha: m.linha, empresa: m.empresa, aviso: a });
  }
  return { resultado: r };
}

const publico = ({ leads, hashes, ...resto }) => resto;

leadsImportacao.post('/leads/importar/previa', async (c) => {
  const a = await analisar(c);
  if (a.resposta) return a.resposta;
  return c.json(publico(a.resultado));
});

leadsImportacao.post('/leads/importar', async (c) => {
  const a = await analisar(c);
  if (a.resposta) return a.resposta;
  const r = a.resultado;
  const corpo = await c.req.json().catch(() => ({}));
  const conf = corpo.confirmar;
  if (conf === null || typeof conf !== 'object' || !Number.isInteger(conf.importaveis) || !Number.isInteger(conf.optOuts)) {
    return falha(c, 'confirmar', 'confirme as contagens da prévia (importaveis e optOuts) antes de importar');
  }
  if (conf.importaveis !== r.importaveis || conf.optOuts !== r.optOuts) {
    return c.json({ erro: 'o arquivo não bate com a prévia que você conferiu; gere a prévia de novo', campo: 'confirmar', previa: { importaveis: r.importaveis, optOuts: r.optOuts } }, 409);
  }

  const DB = c.env.DB;
  const usuario = c.get('usuario').email;
  const ts = new Date().toISOString();

  for (let i = 0; i < r.leads.length; i += LOTE) {
    const comandos = [];
    for (const m of r.leads.slice(i, i + LOTE)) {
      const d = m.lead;
      const id = crypto.randomUUID();
      comandos.push(
        DB.prepare(
          `INSERT INTO lead (id, chave, funil_id, estagio_id, estagio_desde, empresa, telefone, place_id, nota, faixa, origem, base_legal, ultimo_contato_em, ultimo_contato_canal,
             proximo_passo, motivo_perda, observacoes, criado_em, atualizado_em, criado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, `import-${crypto.randomUUID()}`, r.fonte, m.estagio.id, ts, d.empresa, d.telefone ?? null, d.placeId ?? null, d.nota ?? null, d.faixa ?? null, d.origem, d.baseLegal,
          m.ultimoContatoEm, m.ultimoContatoCanal, d.proximoPasso ?? null, m.motivoPerda, d.observacoes ?? null, ts, ts, usuario),
        DB.prepare("INSERT INTO lead_evento (lead_id, ts, tipo, de, para, canal, nota, usuario) VALUES (?, ?, 'criacao', NULL, ?, NULL, NULL, ?)").bind(id, ts, m.estagio.nome, usuario),
        DB.prepare("INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois) VALUES (?, ?, 'importar', 'lead', ?, NULL, ?)").bind(
          ts, usuario, id, JSON.stringify({ funilId: r.fonte, empresa: d.empresa, origem: d.origem, estagio: m.estagio.nome, importado: true }),
        ),
      );
    }
    await DB.batch(comandos);
  }
  const unicos = [...new Map(r.hashes.map(([tipo, h]) => [h, tipo])).entries()];
  for (let i = 0; i < unicos.length; i += 50) {
    await DB.batch(unicos.slice(i, i + 50).map(([h, tipo]) => DB.prepare('INSERT OR IGNORE INTO contato_bloqueado (hash, tipo, criado_em) VALUES (?, ?, ?)').bind(h, tipo, ts)));
  }
  return c.json({ importados: r.importaveis, duplicados: r.duplicados, optOuts: r.optOuts, recusadas: r.recusadas.length }, 201);
});
