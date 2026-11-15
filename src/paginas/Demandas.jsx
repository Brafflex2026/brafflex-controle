import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Link2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ResourceState } from '@/components/resource-state';
import { api } from '@/api';

// Os 14 estados do trilha.py, na ordem do fluxo. Só leitura: o status vem do PC e não se muda aqui.
const ESTADOS = [
  'Triagem', 'Aguardando info', 'Portão zero', 'Em produção', 'Pré-avaliação', 'Portão 1 — REVISOR', 'Portão 2 — Revisão humana',
  'Portão 3 — Cliente', 'Aprovado', 'Liberada para execução', 'Em execução', 'Aguardando Rodrigo', 'Cancelado', 'Concluído',
];
const COMANDOS = {
  abrir: 'Abriu a demanda',
  'aguardar-info': 'Ficou aguardando informação',
  'info-recebida': 'Recebeu a informação',
  'portao-zero-plano': 'Plano do portão zero',
  'portao-zero-decisao': 'Decisão do portão zero',
  'iniciar-producao': 'Iniciou a produção',
  entrega: 'Entregou uma versão',
  'conferencia-mecanica': 'Conferência mecânica',
  'pre-avaliacao': 'Pré-avaliação',
  revisor: 'Parecer do REVISOR',
  humano: 'Revisão humana',
  cliente: 'Resposta do cliente',
  decisao: 'Decisão',
  'autorizar-execucao': 'Autorizou a execução',
  'liberar-execucao': 'Liberou a execução',
  execucao: 'Execução',
  avaliar: 'Avaliação',
  cancelar: 'Cancelou',
  escalar: 'Escalou ao Rodrigo',
  cobranca: 'Cobrança',
  bloqueada: 'Tentativa bloqueada',
};
const rotuloComando = (c) => COMANDOS[c] ?? c;
const quando = (ts) => {
  const d = new Date(`${ts}-03:00`);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
};
const dia = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '');
const hojeBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const texto = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

// ---------- quadro ----------
function Cartao({ d }) {
  const atrasada = d.prazo && d.prazo < hojeBrasilia() && !['Concluído', 'Cancelado'].includes(d.status);
  return (
    <a href={`#/demandas/${d.id}`} className="block rounded-md border bg-card p-3 text-sm shadow-xs hover:border-brand-700">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-brand-700">{d.id}</span>
        <span className="text-xs text-muted-foreground">v{d.versao}{d.devolucoes > 0 ? ` · ${d.devolucoes} devol.` : ''}</span>
      </div>
      <p className="mt-1 line-clamp-2">{d.titulo || 'Sem título'}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{d.marca ?? d.clienteTexto ?? 'Cliente a confirmar'}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {d.semContrato && <Badge variant="outline">Sem contrato</Badge>}
        {d.caminho && <Badge variant="secondary">{d.caminho}</Badge>}
        {d.prazo && <Badge variant={atrasada ? 'destructive' : 'secondary'}>Prazo {dia(d.prazo)}</Badge>}
        {d.responsavel && <Badge variant="secondary">{d.responsavel}</Badge>}
      </div>
    </a>
  );
}

function Quadro() {
  const [estado, setEstado] = useState('carregando');
  const [dados, setDados] = useState({ itens: [], contagens: {}, truncado: false });
  const [campos, setCampos] = useState({ cliente: '', responsavel: '', caminho: '', semContrato: false });
  const [aplicados, setAplicados] = useState(campos);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      setDados(await api.demandas(aplicados));
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, [aplicados]);
  useEffect(() => { carregar(); }, [carregar]);

  const caminhos = [...new Set(dados.itens.map((i) => i.caminho).filter(Boolean))];
  const fora = [...new Set(dados.itens.map((i) => i.status))].filter((s) => !ESTADOS.includes(s));
  const colunas = [...ESTADOS, ...fora].map((s) => ({ s, itens: dados.itens.filter((i) => i.status === s) }));
  const cheias = colunas.filter((c) => c.itens.length > 0);
  const vazias = colunas.filter((c) => c.itens.length === 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Demandas</h1>
      <p className="text-sm text-muted-foreground">O status de cada demanda vem do registro do PC e não se altera aqui.</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setAplicados({ ...campos });
        }}
      >
        <div className="space-y-1">
          <label htmlFor="f-cliente" className="text-xs font-medium">Cliente ou marca</label>
          <Input id="f-cliente" className="w-48" value={campos.cliente} onChange={(e) => setCampos((c) => ({ ...c, cliente: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="f-resp" className="text-xs font-medium">Responsável</label>
          <Input id="f-resp" className="w-40" value={campos.responsavel} onChange={(e) => setCampos((c) => ({ ...c, responsavel: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="f-caminho" className="text-xs font-medium">Caminho</label>
          <NativeSelect id="f-caminho" value={campos.caminho} onChange={(e) => setCampos((c) => ({ ...c, caminho: e.target.value }))}>
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {[...new Set([...caminhos, campos.caminho].filter(Boolean))].map((c) => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={campos.semContrato} onChange={(e) => setCampos((c) => ({ ...c, semContrato: e.target.checked }))} />
          Só sem contrato
        </label>
        <Button type="submit">Filtrar</Button>
      </form>

      {estado === 'carregando' && <ResourceState status="loading" title="Carregando demandas…" />}
      {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar as demandas" description="Confira a conexão e tente de novo." onRetry={carregar} />}
      {estado === 'pronto' && dados.itens.length === 0 && (
        <ResourceState status="empty" title="Nenhuma demanda" description="As demandas aparecem aqui depois que o PC envia a trilha." />
      )}
      {estado === 'pronto' && dados.truncado && <p role="status" className="text-sm text-destructive">Há mais de 500 demandas: só as mais recentes aparecem. Use os filtros.</p>}
      {estado === 'pronto' && dados.itens.length > 0 && (
        <>
          {/* No computador: colunas lado a lado. No celular: uma lista por estado, uma embaixo da outra. */}
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-3 md:overflow-x-auto md:pb-2">
            {cheias.map(({ s, itens }) => (
              <section key={s} aria-label={`${s}: ${itens.length}`} className="md:w-64 md:shrink-0">
                <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
                  <span>{s}</span>
                  <Badge variant="secondary">{dados.contagens[s] ?? itens.length}</Badge>
                </h2>
                <div className="space-y-2">{itens.map((d) => <Cartao key={d.id} d={d} />)}</div>
              </section>
            ))}
          </div>
          {vazias.length > 0 && <p className="text-xs text-muted-foreground">Sem demandas em: {vazias.map((c) => c.s).join(', ')}.</p>}
        </>
      )}
    </div>
  );
}

// ---------- ligar a um contrato ----------
function LigarContrato({ id, aoLigar }) {
  const [clientes, setClientes] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [clienteId, setClienteId] = useState('');
  const [contratoId, setContratoId] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { api.clientes().then(setClientes).catch(() => setErro('Não foi possível carregar os clientes.')); }, []);
  useEffect(() => {
    setContratoId('');
    setContratos([]);
    if (!clienteId) return;
    api.contratosDoCliente(clienteId).then((l) => setContratos(l.filter((k) => k.status === 'ativo'))).catch(() => setErro('Não foi possível carregar os contratos.'));
  }, [clienteId]);

  async function ligar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      aoLigar((await api.ligarDemanda(id, contratoId)).demanda);
    } catch (x) {
      setErro(x.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Link2 aria-hidden="true" className="size-4" />Esta demanda está sem contrato</CardTitle>
        <CardDescription>Escolha o cliente e o contrato. Depois de ligada, não dá para trocar por aqui.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={ligar} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="l-cliente" className="text-xs font-medium">Cliente</label>
            <NativeSelect id="l-cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <NativeSelectOption value="">Escolha…</NativeSelectOption>
              {clientes.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.nome}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor="l-contrato" className="text-xs font-medium">Contrato (marca)</label>
            <NativeSelect id="l-contrato" value={contratoId} onChange={(e) => setContratoId(e.target.value)} disabled={!clienteId}>
              <NativeSelectOption value="">{clienteId && contratos.length === 0 ? 'Sem contrato ativo' : 'Escolha…'}</NativeSelectOption>
              {contratos.map((k) => <NativeSelectOption key={k.id} value={k.id}>{k.marca}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <Button type="submit" disabled={!contratoId || salvando}>{salvando ? 'Ligando…' : 'Ligar'}</Button>
        </form>
        {erro && <p role="alert" className="mt-2 text-sm text-destructive">{erro}</p>}
      </CardContent>
    </Card>
  );
}

// ---------- anotações ----------
function Anotacoes({ demanda, aoSalvar }) {
  const inicial = { prazo: demanda.prazo ?? '', responsavel: demanda.responsavel ?? '', pendenciaNota: demanda.pendenciaNota ?? '', proximoPasso: demanda.proximoPasso ?? '' };
  const [d, setD] = useState(inicial);
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  useEffect(() => { setD(inicial); }, [demanda.prazo, demanda.responsavel, demanda.pendenciaNota, demanda.proximoPasso]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (k) => (e) => { setSalvo(false); setD((x) => ({ ...x, [k]: e.target.value })); };
  const aria = (k) => ({ 'aria-invalid': erro.campo === k ? 'true' : undefined, 'aria-describedby': erro.campo === k ? 'an-erro' : undefined });
  const msg = (k) => erro.campo === k && <p id="an-erro" role="alert" className="text-xs text-destructive">{erro.texto}</p>;

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    try {
      aoSalvar((await api.alterarDemanda(demanda.id, d)).demanda);
      setSalvo(true);
    } catch (x) {
      setErro({ campo: x.campo ?? '', texto: x.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Minhas anotações</CardTitle>
        <CardDescription>Só o app guarda estas quatro. Não escreva dado de paciente, senha nem chave.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="an-prazo" className="text-xs font-medium">Prazo</label>
            <Input id="an-prazo" type="date" value={d.prazo} onChange={mudar('prazo')} {...aria('prazo')} />
            {msg('prazo')}
          </div>
          <div className="space-y-1">
            <label htmlFor="an-resp" className="text-xs font-medium">Responsável</label>
            <Input id="an-resp" value={d.responsavel} onChange={mudar('responsavel')} maxLength={120} {...aria('responsavel')} />
            {msg('responsavel')}
          </div>
          <div className="space-y-1">
            <label htmlFor="an-pend" className="text-xs font-medium">Minha pendência</label>
            <Input id="an-pend" value={d.pendenciaNota} onChange={mudar('pendenciaNota')} maxLength={500} {...aria('pendenciaNota')} />
            {msg('pendenciaNota')}
          </div>
          <div className="space-y-1">
            <label htmlFor="an-prox" className="text-xs font-medium">Próximo passo</label>
            <Input id="an-prox" value={d.proximoPasso} onChange={mudar('proximoPasso')} maxLength={500} {...aria('proximoPasso')} />
            {msg('proximoPasso')}
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar anotações'}</Button>
            {salvo && <span role="status" className="text-sm text-muted-foreground">Salvo.</span>}
            {erro.texto && !erro.campo && <span role="alert" className="text-sm text-destructive">{erro.texto}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------- detalhe ----------
function Resumo({ rotulo, valor }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{valor || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function Detalhe({ id }) {
  const [estado, setEstado] = useState('carregando');
  const [info, setInfo] = useState(null);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      setInfo(await api.demanda(id));
      setEstado('pronto');
    } catch (x) {
      setEstado(x.status === 404 ? 'nao-existe' : 'erro');
    }
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);

  const voltar = <a href="#/demandas" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ArrowLeft aria-hidden="true" className="size-4" />Voltar ao quadro</a>;
  if (estado === 'carregando') return <div className="space-y-4">{voltar}<ResourceState status="loading" title="Carregando a demanda…" /></div>;
  if (estado === 'nao-existe') return <div className="space-y-4">{voltar}<ResourceState status="empty" title="Demanda não encontrada" /></div>;
  if (estado === 'erro') return <div className="space-y-4">{voltar}<ResourceState status="error" title="Não foi possível carregar a demanda" description="Confira a conexão e tente de novo." onRetry={carregar} /></div>;

  const { demanda, estado: e, verificacao, eventos } = info;
  const atualizarDemanda = (nova) => setInfo((i) => ({ ...i, demanda: nova }));
  const lista = (v) => (Array.isArray(v) && v.length > 0 ? v.map(texto).join('; ') : '');

  return (
    <div className="space-y-5">
      {voltar}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{demanda.id} · {demanda.titulo || 'Sem título'}</h1>
        <Badge>{demanda.status}</Badge>
        {demanda.modo && <Badge variant="outline">{demanda.modo}</Badge>}
        {demanda.custoAlto && <Badge variant="destructive">Custo alto</Badge>}
      </div>

      {demanda.semContrato ? (
        <LigarContrato id={demanda.id} aoLigar={atualizarDemanda} />
      ) : (
        <p className="text-sm">Contrato: <a className="font-medium text-brand-700 hover:underline" href={`#/contratos/${demanda.contratoId}`}>{demanda.marca}</a></p>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Situação (vinda da trilha)</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Resumo rotulo="Cliente na trilha" valor={demanda.clienteTexto} />
            <Resumo rotulo="Caminho" valor={demanda.caminho} />
            <Resumo rotulo="Versão" valor={`v${demanda.versao}`} />
            <Resumo rotulo="Devoluções" valor={String(demanda.devolucoes)} />
            <Resumo rotulo="Pendência da trilha" valor={texto(e?.pendencia)} />
            <Resumo rotulo="Bloqueios" valor={lista(e?.bloqueios)} />
            <Resumo rotulo="Escalações" valor={lista(e?.escalacoes)} />
            <Resumo rotulo="Cobranças" valor={lista(e?.cobrancas)} />
            <Resumo rotulo="Execuções" valor={Array.isArray(e?.execucoes) ? `${e.execucoes.length}` : ''} />
          </dl>
          {Array.isArray(e?.tentativas_bloqueadas) && e.tentativas_bloqueadas.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">{e.tentativas_bloqueadas.length} tentativa(s) bloqueada(s) pelo trilha.py (veja na linha do tempo).</p>
          )}
        </CardContent>
      </Card>

      <Anotacoes demanda={demanda} aoSalvar={atualizarDemanda} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Linha do tempo</CardTitle>
          <CardDescription className="flex items-start gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>Conferido no PC: {verificacao || 'sem resultado'}. As assinaturas só o PC confere; o app confere a cadeia de hash no envio.</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {eventos.map((ev) => (
              <li key={ev.n} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{ev.n}. {rotuloComando(ev.cmd)}</span>
                  <span className="text-xs text-muted-foreground">{quando(ev.ts)} · {ev.ator}{ev.assinado ? ' · assinado' : ''}</span>
                </div>
                {ev.dados && Object.keys(ev.dados).length > 0 && (
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                    {Object.entries(ev.dados).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-words">{texto(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">hash {ev.hash.slice(0, 16)}…</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

export function Demandas({ id }) {
  return id ? <Detalhe id={id} /> : <Quadro />;
}
