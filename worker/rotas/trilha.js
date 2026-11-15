import { Hono } from 'hono';
import { verificarTrilha } from '../barreira.js';

export const trilha = new Hono();

const MAX_CORPO = 2_000_000;
const MAX_LINHAS = 1000;
const MAX_LINHA = 20_000;
const MAX_ESTADO = 200_000;
const HEX64 = /^[0-9a-f]{64}$/;
const CAMPOS_DA_LINHA = new Set(['n', 'ts', 'cmd', 'ator', 'dados', 'prev', 'assinatura']);
const CAMPOS_FORA_DA_BARREIRA = new Set(['hash', 'prev', 'assinatura']); // 64 caracteres por natureza

const recusa = (c, status, corpo) => c.json(corpo, status);
const erro422 = (c, campo, motivo, extra = {}) => recusa(c, 422, { erro: motivo, campo, motivo, ...extra });
const erro409 = (c, motivo, extra = {}) => recusa(c, 409, { erro: motivo, motivo, ...extra });

async function sha256(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Percorre os textos de um valor (sem olhar os campos de hash) e devolve o motivo do primeiro padrão sensível.
function procurarSensivel(valor, chave = '') {
  if (CAMPOS_FORA_DA_BARREIRA.has(chave)) return null;
  if (typeof valor === 'string') return verificarTrilha(valor)?.motivo ?? null;
  if (Array.isArray(valor)) {
    for (const v of valor) {
      const m = procurarSensivel(v);
      if (m) return m;
    }
  } else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      const m = procurarSensivel(k) ?? procurarSensivel(v, k);
      if (m) return m;
    }
  }
  return null;
}

const objetoSimples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Lê e confere a forma de cada linha. Devolve { itens } ou { falha: [campo, mensagem, linha] }.
function lerLinhas(linhas) {
  const itens = [];
  for (let i = 0; i < linhas.length; i++) {
    const texto = linhas[i];
    if (typeof texto !== 'string' || texto.length === 0 || texto.length > MAX_LINHA) return { falha: ['linhas', `a linha ${i + 1} está vazia ou passa de 20.000 caracteres`, i + 1] };
    let ev;
    try {
      ev = JSON.parse(texto);
    } catch {
      return { falha: ['linhas', `a linha ${i + 1} não é um JSON válido`, i + 1] };
    }
    if (!objetoSimples(ev)) return { falha: ['linhas', `a linha ${i + 1} não é um evento`, i + 1] };
    const extras = Object.keys(ev).filter((k) => !CAMPOS_DA_LINHA.has(k));
    if (extras.length) return { falha: ['linhas', `a linha ${i + 1} tem campo desconhecido`, i + 1] };
    const bom =
      Number.isInteger(ev.n) && ev.n >= 1 &&
      typeof ev.ts === 'string' && ev.ts.length <= 40 &&
      typeof ev.cmd === 'string' && ev.cmd.length > 0 && ev.cmd.length <= 40 &&
      typeof ev.ator === 'string' && ev.ator.length > 0 && ev.ator.length <= 40 &&
      objetoSimples(ev.dados) &&
      typeof ev.prev === 'string' && (ev.prev === '' || HEX64.test(ev.prev)) &&
      (ev.assinatura === undefined || (typeof ev.assinatura === 'string' && HEX64.test(ev.assinatura)));
    if (!bom) return { falha: ['linhas', `a linha ${i + 1} não tem a forma de um evento da trilha`, i + 1] };
    itens.push({ texto, ev });
  }
  return { itens };
}

function conferirEstado(estado, id) {
  if (!objetoSimples(estado)) return 'o estado precisa ser um objeto';
  if (estado.id !== id) return 'o id do estado não é o da demanda da rota';
  if (typeof estado.status !== 'string' || estado.status.length === 0 || estado.status.length > 80) return 'status inválido';
  if (!Number.isInteger(estado.versao) || estado.versao < 0) return 'versão inválida';
  if (!Number.isInteger(estado.devolucoes) || estado.devolucoes < 0) return 'devoluções inválidas';
  if (JSON.stringify(estado).length > MAX_ESTADO) return 'o estado passa do tamanho permitido';
  return null;
}

// Envio da trilha pelo script do PC. Só aceita o service token configurado (ver worker/acesso.js).
trilha.post('/trilha/:demanda', async (c) => {
  if (!c.get('servico')) return c.json({ erro: 'só o script de envio da trilha pode usar esta rota' }, 403);

  const id = c.req.param('demanda');
  if (!/^D-\d{3,}$/.test(id)) return erro422(c, 'demanda', 'o identificador da demanda deve ser como D-000');

  if (Number(c.req.header('content-length') ?? 0) > MAX_CORPO) return c.json({ erro: 'envio grande demais' }, 413);
  const bruto = await c.req.text();
  if (bruto.length > MAX_CORPO) return c.json({ erro: 'envio grande demais' }, 413);
  let corpo;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    return erro422(c, 'corpo', 'o envio não é um JSON válido');
  }
  if (!objetoSimples(corpo)) return erro422(c, 'corpo', 'o envio precisa ser um objeto');

  const { linhas, estado, verificacao } = corpo;
  if (!Array.isArray(linhas) || linhas.length < 1 || linhas.length > MAX_LINHAS) return erro422(c, 'linhas', `envie de 1 a ${MAX_LINHAS} linhas`);
  const lidas = lerLinhas(linhas);
  if (lidas.falha) return erro422(c, lidas.falha[0], lidas.falha[1], { linha: lidas.falha[2] });
  const itens = lidas.itens;

  const falhaEstado = conferirEstado(estado, id);
  if (falhaEstado) return erro422(c, 'estado', falhaEstado);
  if (typeof verificacao !== 'string' || verificacao.length > 500) return erro422(c, 'verificacao', 'falta o resultado da verificação do PC');

  // A verificação feita no PC precisa dizer "íntegro" e contar as mesmas linhas que chegaram.
  const ultimoN = itens.at(-1).ev.n;
  const verificada = /^ÍNTEGRO: (\d+) eventos íntegros/.exec(verificacao);
  if (!verificada) return erro409(c, 'a verificação do PC não confirmou a integridade da trilha');
  if (Number(verificada[1]) !== ultimoN) return erro409(c, 'a verificação do PC não corresponde às linhas enviadas');

  // Numeração seguida dentro do envio.
  for (let i = 1; i < itens.length; i++) {
    if (itens[i].ev.n !== itens[i - 1].ev.n + 1) return erro409(c, 'linhas fora de ordem ou com buraco', { linha: i + 1 });
  }

  const DB = c.env.DB;
  const atual = await DB.prepare('SELECT n_eventos, trilha_head, contrato_id, titulo FROM demanda WHERE id = ?').bind(id).first();
  const gravados = atual?.n_eventos ?? 0;
  const primeiro = itens[0].ev.n;
  if (primeiro > gravados + 1) return erro409(c, `faltam as linhas ${gravados + 1} a ${primeiro - 1}: o envio não encaixa na trilha já gravada`, { linha: 1 });

  // O que já está gravado na faixa do envio (mais a linha anterior, para conferir o prev da primeira).
  const faixa = (
    await DB.prepare('SELECT n, linha, hash FROM trilha_evento WHERE demanda_id = ? AND n >= ? AND n <= ?').bind(id, Math.max(primeiro - 1, 1), ultimoN).all()
  ).results;
  const gravadoEm = new Map(faixa.map((r) => [r.n, r]));

  // Cadeia: prev de cada linha = hash do texto da anterior.
  const hashes = [];
  for (const it of itens) hashes.push(await sha256(it.texto));
  for (let i = 0; i < itens.length; i++) {
    const { ev, texto } = itens[i];
    const esperado = i > 0 ? hashes[i - 1] : primeiro === 1 ? '' : gravadoEm.get(primeiro - 1)?.hash;
    if (ev.prev !== esperado) return erro409(c, 'cadeia quebrada: o hash da linha anterior não bate', { linha: i + 1 });
    if (ev.n === 1 && ev.cmd !== 'abrir') return erro409(c, 'a primeira linha da trilha precisa ser "abrir"', { linha: i + 1 });
    if (ev.n <= gravados) {
      const guardada = gravadoEm.get(ev.n);
      if (!guardada || guardada.linha !== texto) return erro409(c, 'a linha já gravada tem conteúdo diferente do enviado', { linha: i + 1 });
    }
  }

  const novas = itens.filter((it) => it.ev.n > gravados);
  const ignoradas = itens.length - novas.length;
  if (novas.length === 0) {
    return c.json({ aceitas: 0, ignoradas, demanda: { id, status: estado.status, versao: estado.versao, semContrato: !atual?.contrato_id } });
  }

  // Dado sensível: só nas linhas novas (as antigas já passaram) e no estado.
  for (const it of novas) {
    const motivo = procurarSensivel({ ator: it.ev.ator, cmd: it.ev.cmd, dados: it.ev.dados });
    if (motivo) return erro422(c, 'linhas', motivo, { linha: itens.indexOf(it) + 1 });
  }
  const motivoEstado = procurarSensivel(estado);
  if (motivoEstado) return erro422(c, 'estado', motivoEstado);

  // Liga a demanda a um contrato quando o cliente do estado é a marca de UM único contrato; senão, "sem contrato".
  let contratoId = atual?.contrato_id ?? null;
  if (!contratoId && typeof estado.cliente === 'string' && estado.cliente.trim() !== '') {
    const achados = (await DB.prepare('SELECT id FROM contrato WHERE lower(marca) = lower(?) LIMIT 2').bind(estado.cliente.trim()).all()).results;
    if (achados.length === 1) contratoId = achados[0].id;
  }
  const abrir = itens.find((it) => it.ev.n === 1);
  const titulo = typeof abrir?.ev.dados?.titulo === 'string' ? abrir.ev.dados.titulo : null;

  const agora = new Date().toISOString();
  const ultimo = itens.at(-1);
  const novoHead = hashes.at(-1);
  const servico = c.get('servico');
  // A demanda precisa ter chegado ao novo ponto POR ESTE envio: na posição nova e sem os eventos já gravados.
  // (Se outro envio igual entrou primeiro, estes eventos já existem e este lote não grava nada.)
  const guarda = `EXISTS (SELECT 1 FROM demanda WHERE id = ? AND n_eventos = ? AND trilha_head = ?)
    AND NOT EXISTS (SELECT 1 FROM trilha_evento WHERE demanda_id = ? AND n = ?)`;
  const bindsGuarda = [id, ultimo.ev.n, novoHead, id, novas[0].ev.n];
  const linhasJson = JSON.stringify(
    await Promise.all(
      novas.map(async (it) => ({
        n: it.ev.n,
        ts: it.ev.ts,
        cmd: it.ev.cmd,
        ator: it.ev.ator,
        dados: JSON.stringify(it.ev.dados),
        prev: it.ev.prev,
        hash: hashes[itens.indexOf(it)],
        assinatura: it.ev.assinatura ?? null,
        linha: it.texto,
      })),
    ),
  );

  // Um lote só, nesta ordem: estado da demanda (só avança se ainda estiver onde foi lida), auditoria e eventos.
  // Entram juntos ou nenhum. A auditoria vem antes dos eventos porque a proteção olha se os eventos já existem.
  const resultados = await DB.batch([
    DB.prepare(
      `INSERT INTO demanda (id, contrato_id, cliente_texto, titulo, modo, custo_alto, caminho, status, versao, devolucoes, estado, n_eventos, trilha_head, ultimo_evento_em, verificacao, recebido_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         cliente_texto = excluded.cliente_texto, modo = excluded.modo, custo_alto = excluded.custo_alto, caminho = excluded.caminho,
         status = excluded.status, versao = excluded.versao, devolucoes = excluded.devolucoes, estado = excluded.estado,
         n_eventos = excluded.n_eventos, trilha_head = excluded.trilha_head, ultimo_evento_em = excluded.ultimo_evento_em,
         verificacao = excluded.verificacao, atualizado_em = excluded.atualizado_em,
         contrato_id = COALESCE(demanda.contrato_id, excluded.contrato_id), titulo = COALESCE(demanda.titulo, excluded.titulo)
       WHERE demanda.n_eventos = ?`,
    ).bind(
      id, contratoId, typeof estado.cliente === 'string' ? estado.cliente : null, titulo, typeof estado.modo === 'string' ? estado.modo : null,
      estado.custo_alto ? 1 : 0, typeof estado.caminho === 'string' ? estado.caminho : null, estado.status, estado.versao, estado.devolucoes,
      JSON.stringify(estado), ultimo.ev.n, novoHead, ultimo.ev.ts, verificacao, agora, agora, gravados,
    ),
    DB.prepare(
      `INSERT INTO auditoria_app (ts, usuario, acao, entidade, entidade_id, antes, depois)
       SELECT ?, ?, 'enviar_trilha', 'demanda', ?, NULL, ? WHERE ${guarda}`,
    ).bind(agora, `servico:${servico}`, id, JSON.stringify({ aceitas: novas.length, ate: ultimo.ev.n, status: estado.status }), ...bindsGuarda),
    DB.prepare(
      `INSERT INTO trilha_evento (demanda_id, n, ts, cmd, ator, dados, prev, hash, assinatura, linha, recebido_em)
       SELECT ?, json_extract(value, '$.n'), json_extract(value, '$.ts'), json_extract(value, '$.cmd'), json_extract(value, '$.ator'),
              json_extract(value, '$.dados'), json_extract(value, '$.prev'), json_extract(value, '$.hash'), json_extract(value, '$.assinatura'),
              json_extract(value, '$.linha'), ?
       FROM json_each(?) WHERE ${guarda}`,
    ).bind(id, agora, linhasJson, ...bindsGuarda),
  ]);

  if (resultados[2].meta.changes !== novas.length) {
    return erro409(c, 'outro envio desta demanda chegou antes; envie de novo');
  }
  return c.json({ aceitas: novas.length, ignoradas, demanda: { id, status: estado.status, versao: estado.versao, contratoId, semContrato: !contratoId } });
});
