import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus, TriangleAlert, Upload } from 'lucide-react';
import { ImportarLeads } from '@/paginas/ImportarLeads';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ResourceState } from '@/components/resource-state';
import { api } from '@/api';

const hojeBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const dia = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const nulo = (v) => ((v ?? '').trim() === '' ? null : v.trim());

// ---------- campos reutilizáveis ----------
function Campo({ id, rotulo, erro, children }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium">{rotulo}</label>
      {children}
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
const aria = (erro, campo) => ({ 'aria-invalid': erro.campo === campo ? 'true' : undefined });
const msgDe = (erro, campo) => (erro.campo === campo ? erro.texto : null);

// ---------- novo lead ----------
function NovoLead({ aberto, aoFechar, aoCriado, funis, funilInicial }) {
  const [d, setD] = useState({});
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setChave(crypto.randomUUID());
    setErro({ campo: '', texto: '' });
    setD({ funilId: funilInicial, empresa: '', contato: '', telefone: '', placeId: '', nota: '', faixa: '', origem: '', baseLegal: '', consentimentoEm: '', consentimentoComo: '', responsavel: '', observacoes: '', proximoPasso: '', proximoPassoEm: '' });
  }, [aberto, funilInicial]);
  const mudar = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    const corpo = { funilId: d.funilId, empresa: d.empresa, origem: d.origem, baseLegal: d.baseLegal };
    for (const k of ['contato', 'telefone', 'placeId', 'faixa', 'consentimentoEm', 'consentimentoComo', 'responsavel', 'observacoes', 'proximoPasso', 'proximoPassoEm']) if (nulo(d[k])) corpo[k] = d[k].trim();
    if (d.nota !== '') corpo.nota = Number(d.nota);
    try {
      const { lead } = await api.criarLead(corpo, chave);
      aoCriado(lead);
      aoFechar();
    } catch (x) {
      setErro({ campo: x.campo ?? '', texto: x.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>Origem e base legal são obrigatórias. Não escreva dado de paciente nem telefone fora do campo de telefone.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
          <Campo id="nl-funil" rotulo="Funil" erro={msgDe(erro, 'funilId')}>
            <NativeSelect id="nl-funil" value={d.funilId ?? ''} onChange={mudar('funilId')}>
              {funis.itens.map((f) => <NativeSelectOption key={f.id} value={f.id}>{f.nome}</NativeSelectOption>)}
            </NativeSelect>
          </Campo>
          <Campo id="nl-empresa" rotulo="Empresa" erro={msgDe(erro, 'empresa')}>
            <Input id="nl-empresa" value={d.empresa ?? ''} onChange={mudar('empresa')} maxLength={200} required {...aria(erro, 'empresa')} />
          </Campo>
          <Campo id="nl-origem" rotulo="Origem" erro={msgDe(erro, 'origem')}>
            <NativeSelect id="nl-origem" value={d.origem ?? ''} onChange={mudar('origem')} required {...aria(erro, 'origem')}>
              <NativeSelectOption value="">Escolha…</NativeSelectOption>
              {funis.origens.map((o) => <NativeSelectOption key={o.nome} value={o.nome} disabled={o.bloqueada}>{o.nome}{o.bloqueada ? ' (bloqueada até registrar a base legal)' : ''}</NativeSelectOption>)}
            </NativeSelect>
          </Campo>
          <Campo id="nl-base" rotulo="Base legal" erro={msgDe(erro, 'baseLegal')}>
            <NativeSelect id="nl-base" value={d.baseLegal ?? ''} onChange={mudar('baseLegal')} required {...aria(erro, 'baseLegal')}>
              <NativeSelectOption value="">Escolha…</NativeSelectOption>
              {funis.basesLegais.map((b) => <NativeSelectOption key={b} value={b}>{b}</NativeSelectOption>)}
            </NativeSelect>
          </Campo>
          {d.baseLegal === 'consentimento' && (
            <>
              <Campo id="nl-cons-em" rotulo="Consentimento dado em" erro={msgDe(erro, 'consentimentoEm')}>
                <Input id="nl-cons-em" type="date" max={hojeBrasilia()} value={d.consentimentoEm ?? ''} onChange={mudar('consentimentoEm')} {...aria(erro, 'consentimentoEm')} />
              </Campo>
              <Campo id="nl-cons-como" rotulo="Como foi dado" erro={msgDe(erro, 'consentimentoComo')}>
                <Input id="nl-cons-como" value={d.consentimentoComo ?? ''} onChange={mudar('consentimentoComo')} {...aria(erro, 'consentimentoComo')} />
              </Campo>
            </>
          )}
          <Campo id="nl-contato" rotulo="Nome do contato" erro={msgDe(erro, 'contato')}>
            <Input id="nl-contato" value={d.contato ?? ''} onChange={mudar('contato')} maxLength={120} {...aria(erro, 'contato')} />
          </Campo>
          <Campo id="nl-tel" rotulo="Telefone (DDD + número)" erro={msgDe(erro, 'telefone')}>
            <Input id="nl-tel" inputMode="tel" value={d.telefone ?? ''} onChange={mudar('telefone')} {...aria(erro, 'telefone')} />
          </Campo>
          <Campo id="nl-place" rotulo="Place ID (Google Maps)" erro={msgDe(erro, 'placeId')}>
            <Input id="nl-place" value={d.placeId ?? ''} onChange={mudar('placeId')} {...aria(erro, 'placeId')} />
          </Campo>
          <Campo id="nl-resp" rotulo="Responsável" erro={msgDe(erro, 'responsavel')}>
            <Input id="nl-resp" value={d.responsavel ?? ''} onChange={mudar('responsavel')} maxLength={120} {...aria(erro, 'responsavel')} />
          </Campo>
          <Campo id="nl-nota" rotulo="Nota (0 a 100)" erro={msgDe(erro, 'nota')}>
            <Input id="nl-nota" type="number" min={0} max={100} value={d.nota ?? ''} onChange={mudar('nota')} {...aria(erro, 'nota')} />
          </Campo>
          <Campo id="nl-faixa" rotulo="Faixa" erro={msgDe(erro, 'faixa')}>
            <NativeSelect id="nl-faixa" value={d.faixa ?? ''} onChange={mudar('faixa')}>
              <NativeSelectOption value="">—</NativeSelectOption>
              {['Quente', 'Morno', 'Frio'].map((f) => <NativeSelectOption key={f} value={f}>{f}</NativeSelectOption>)}
            </NativeSelect>
          </Campo>
          <Campo id="nl-passo" rotulo="Próximo passo" erro={msgDe(erro, 'proximoPasso')}>
            <Input id="nl-passo" value={d.proximoPasso ?? ''} onChange={mudar('proximoPasso')} maxLength={300} {...aria(erro, 'proximoPasso')} />
          </Campo>
          <Campo id="nl-passo-em" rotulo="Data do próximo passo" erro={msgDe(erro, 'proximoPassoEm')}>
            <Input id="nl-passo-em" type="date" value={d.proximoPassoEm ?? ''} onChange={mudar('proximoPassoEm')} {...aria(erro, 'proximoPassoEm')} />
          </Campo>
          <div className="sm:col-span-2">
            <Campo id="nl-obs" rotulo="Observações" erro={msgDe(erro, 'observacoes')}>
              <Textarea id="nl-obs" rows={2} value={d.observacoes ?? ''} onChange={mudar('observacoes')} {...aria(erro, 'observacoes')} />
            </Campo>
          </div>
          {erro.texto && !erro.campo && <p role="alert" className="text-sm text-destructive sm:col-span-2">{erro.texto}</p>}
          {erro.campo && !['funilId', 'empresa', 'origem', 'baseLegal', 'consentimentoEm', 'consentimentoComo', 'contato', 'telefone', 'placeId', 'responsavel', 'nota', 'faixa', 'proximoPasso', 'proximoPassoEm', 'observacoes'].includes(erro.campo) && <p role="alert" className="text-sm text-destructive sm:col-span-2">{erro.texto}</p>}
          <DialogFooter className="sm:col-span-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Cadastrar lead'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- quadro ----------
function CartaoLead({ l }) {
  return (
    <a href={`#/funil/${l.id}`} className="block rounded-md border bg-card p-3 text-sm shadow-xs hover:border-brand-700">
      <p className="font-medium">{l.empresa}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {l.faixa && <Badge variant={l.faixa === 'Quente' ? 'default' : 'secondary'}>{l.faixa}{l.nota !== null ? ` ${l.nota}` : ''}</Badge>}
        {l.vencido && <Badge variant="destructive">Passo vencido</Badge>}
        {l.responsavel && <Badge variant="outline">{l.responsavel}</Badge>}
      </div>
      {l.proximoPasso && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{l.proximoPasso}{l.proximoPassoEm ? ` · ${dia(l.proximoPassoEm)}` : ''}</p>}
    </a>
  );
}

function Quadro() {
  const [funis, setFunis] = useState(null);
  const [funilId, setFunilId] = useState('');
  const [estado, setEstado] = useState('carregando');
  const [dados, setDados] = useState({ itens: [], contagens: {}, vencidos: 0, semProximoPasso: 0 });
  const [campos, setCampos] = useState({ q: '', responsavel: '' });
  const [aplicados, setAplicados] = useState(campos);
  const [soVencidos, setSoVencidos] = useState(false);
  const [novo, setNovo] = useState(false);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    api.funis().then((f) => { setFunis(f); setFunilId((x) => x || f.itens.find((i) => i.id === 'etiqueteria')?.id || f.itens[0].id); }).catch(() => setEstado('erro'));
  }, []);

  const carregar = useCallback(async () => {
    if (!funilId) return;
    setEstado('carregando');
    try {
      setDados(await api.leads({ funil: funilId, ...aplicados, vencidos: soVencidos }));
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, [funilId, aplicados, soVencidos]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!funis) return estado === 'erro' ? <ResourceState status="error" title="Não foi possível carregar os funis" description="Confira a conexão e tente de novo." onRetry={() => window.location.reload()} /> : <ResourceState status="loading" title="Carregando…" />;
  const funil = funis.itens.find((f) => f.id === funilId);
  const colunas = funil.estagios.map((e) => ({ e, itens: dados.itens.filter((i) => i.estagioId === e.id) }));
  const cheias = colunas.filter((c) => c.itens.length > 0);
  const vazias = colunas.filter((c) => c.itens.length === 0).map((c) => c.e.nome);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Funil e CRM</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportando(true)}><Upload aria-hidden="true" />Importar leads</Button>
          <Button onClick={() => setNovo(true)}><Plus aria-hidden="true" />Novo lead</Button>
        </div>
      </div>
      <div role="tablist" aria-label="Funis" className="flex flex-wrap gap-2">
        {funis.itens.map((f) => (
          <button key={f.id} role="tab" type="button" aria-selected={f.id === funilId} onClick={() => setFunilId(f.id)}
            className={f.id === funilId ? 'rounded-md bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700' : 'rounded-md px-3 py-1.5 text-sm hover:bg-muted'}>{f.nome}</button>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setAplicados({ ...campos }); }}>
        <Campo id="q-busca" rotulo="Empresa"><Input id="q-busca" className="w-48" value={campos.q} onChange={(e) => setCampos((c) => ({ ...c, q: e.target.value }))} /></Campo>
        <Campo id="q-resp" rotulo="Responsável"><Input id="q-resp" className="w-40" value={campos.responsavel} onChange={(e) => setCampos((c) => ({ ...c, responsavel: e.target.value }))} /></Campo>
        <Button type="submit">Filtrar</Button>
      </form>

      {estado === 'pronto' && (dados.vencidos > 0 || dados.semProximoPasso > 0) && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm">
          <TriangleAlert aria-hidden="true" className="size-4 text-destructive" />
          <span>{dados.vencidos} com próximo passo vencido · {dados.semProximoPasso} sem próximo passo</span>
          {dados.vencidos > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setSoVencidos((v) => !v)}>{soVencidos ? 'Ver todos' : 'Ver só os vencidos'}</Button>}
        </div>
      )}

      {estado === 'carregando' && <ResourceState status="loading" title="Carregando leads…" />}
      {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar os leads" description="Confira a conexão e tente de novo." onRetry={carregar} />}
      {estado === 'pronto' && dados.itens.length === 0 && <ResourceState status="empty" title="Nenhum lead aqui" description="Cadastre o primeiro em “Novo lead”." />}
      {estado === 'pronto' && dados.itens.length > 0 && (
        <>
          {/* No computador: colunas lado a lado. No celular: uma lista por estágio. */}
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-3 md:overflow-x-auto md:pb-2">
            {cheias.map(({ e, itens }) => (
              <section key={e.id} aria-label={`${e.nome}: ${itens.length}`} className="md:w-60 md:shrink-0">
                <h2 className="mb-2 flex items-center justify-between text-sm font-semibold"><span>{e.nome}</span><Badge variant="secondary">{dados.contagens[e.id] ?? itens.length}</Badge></h2>
                <div className="space-y-2">{itens.map((l) => <CartaoLead key={l.id} l={l} />)}</div>
              </section>
            ))}
          </div>
          {vazias.length > 0 && <p className="text-xs text-muted-foreground">Sem leads em: {vazias.join(', ')}.</p>}
        </>
      )}

      <ImportarLeads aberto={importando} aoFechar={() => setImportando(false)} aoImportado={(f) => { setFunilId(f); carregar(); }} />
      <NovoLead aberto={novo}aoFechar={() => setNovo(false)} aoCriado={(l) => { setFunilId(l.funilId); carregar(); }} funis={funis} funilInicial={funilId} />
    </div>
  );
}

// ---------- detalhe ----------
function MoverEstagio({ lead, funil, aoMudar }) {
  const [d, setD] = useState({ estagioId: '', motivoPerda: '', nota: '', proximoPasso: '', proximoPassoEm: '' });
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);
  const destino = funil.estagios.find((e) => e.id === d.estagioId);
  const opcoes = funil.estagios.filter((e) => e.id !== lead.estagioId && e.final !== 'Não contatar');
  const travado = lead.final === 'Ganho' || lead.final === 'Não contatar';
  const mudar = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    const corpo = { tipo: 'estagio', estagioId: d.estagioId };
    if (destino?.final === 'Perdido') corpo.motivoPerda = d.motivoPerda;
    for (const k of ['nota', 'proximoPasso', 'proximoPassoEm']) if (nulo(d[k])) corpo[k] = d[k].trim();
    try {
      aoMudar(await api.eventoLead(lead.id, corpo));
      setD({ estagioId: '', motivoPerda: '', nota: '', proximoPasso: '', proximoPassoEm: '' });
    } catch (x) {
      setErro({ campo: x.campo ?? '', texto: x.message });
    } finally {
      setSalvando(false);
    }
  }
  if (travado) return <p className="text-sm text-muted-foreground">Este lead está em "{lead.estagioNome}" e não muda de estágio.</p>;
  return (
    <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
      <Campo id="mv-est" rotulo="Mover para" erro={msgDe(erro, 'estagioId')}>
        <NativeSelect id="mv-est" value={d.estagioId} onChange={mudar('estagioId')} required>
          <NativeSelectOption value="">Escolha…</NativeSelectOption>
          {opcoes.map((e) => <NativeSelectOption key={e.id} value={e.id}>{e.nome}</NativeSelectOption>)}
        </NativeSelect>
      </Campo>
      {destino?.final === 'Perdido' && (
        <Campo id="mv-motivo" rotulo="Motivo da perda" erro={msgDe(erro, 'motivoPerda')}>
          <NativeSelect id="mv-motivo" value={d.motivoPerda} onChange={mudar('motivoPerda')} required>
            <NativeSelectOption value="">Escolha…</NativeSelectOption>
            {['sem resposta', 'sem interesse', 'já tem solução', 'preço', 'fora do perfil', 'momento errado', 'outro'].map((m) => <NativeSelectOption key={m} value={m}>{m}</NativeSelectOption>)}
          </NativeSelect>
        </Campo>
      )}
      <Campo id="mv-passo" rotulo="Próximo passo (opcional)" erro={msgDe(erro, 'proximoPasso')}><Input id="mv-passo" value={d.proximoPasso} onChange={mudar('proximoPasso')} maxLength={300} /></Campo>
      <Campo id="mv-passo-em" rotulo={destino?.final === 'Nutrir' ? 'Data para retomar (obrigatória)' : 'Data do próximo passo'} erro={msgDe(erro, 'proximoPassoEm')}>
        <Input id="mv-passo-em" type="date" value={d.proximoPassoEm} onChange={mudar('proximoPassoEm')} required={destino?.final === 'Nutrir'} />
      </Campo>
      <div className="sm:col-span-2"><Campo id="mv-nota" rotulo="Nota (opcional)" erro={msgDe(erro, 'nota')}><Input id="mv-nota" value={d.nota} onChange={mudar('nota')} maxLength={500} /></Campo></div>
      {erro.texto && !erro.campo && <p role="alert" className="text-sm text-destructive sm:col-span-2">{erro.texto}</p>}
      <div className="sm:col-span-2"><Button type="submit" disabled={salvando || !d.estagioId}>{salvando ? 'Movendo…' : 'Mover de estágio'}</Button></div>
    </form>
  );
}

function RegistrarContato({ lead, aoRegistrar }) {
  const [d, setD] = useState({ canal: '', nota: '', proximoPasso: '', proximoPassoEm: '' });
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);
  const mudar = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    const corpo = { tipo: 'contato', canal: d.canal };
    for (const k of ['nota', 'proximoPasso', 'proximoPassoEm']) if (nulo(d[k])) corpo[k] = d[k].trim();
    try {
      aoRegistrar(await api.eventoLead(lead.id, corpo));
      setD({ canal: '', nota: '', proximoPasso: '', proximoPassoEm: '' });
    } catch (x) {
      setErro({ campo: x.campo ?? '', texto: x.message });
    } finally {
      setSalvando(false);
    }
  }
  return (
    <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
      <Campo id="ct-canal" rotulo="Canal (ex.: WhatsApp, e-mail, ligação)" erro={msgDe(erro, 'canal')}><Input id="ct-canal" value={d.canal} onChange={mudar('canal')} maxLength={60} required /></Campo>
      <Campo id="ct-nota" rotulo="O que foi dito (sem telefone nem dado de paciente)" erro={msgDe(erro, 'nota')}><Input id="ct-nota" value={d.nota} onChange={mudar('nota')} maxLength={500} /></Campo>
      <Campo id="ct-passo" rotulo="Próximo passo" erro={msgDe(erro, 'proximoPasso')}><Input id="ct-passo" value={d.proximoPasso} onChange={mudar('proximoPasso')} maxLength={300} /></Campo>
      <Campo id="ct-passo-em" rotulo="Data do próximo passo" erro={msgDe(erro, 'proximoPassoEm')}><Input id="ct-passo-em" type="date" value={d.proximoPassoEm} onChange={mudar('proximoPassoEm')} /></Campo>
      {erro.texto && !erro.campo && <p role="alert" className="text-sm text-destructive sm:col-span-2">{erro.texto}</p>}
      <div className="sm:col-span-2"><Button type="submit" disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar contato'}</Button></div>
    </form>
  );
}

function EditarLead({ lead, aoSalvar }) {
  const inicial = { empresa: lead.empresa ?? '', contato: lead.contato ?? '', telefone: lead.telefone ?? '', placeId: lead.placeId ?? '', responsavel: lead.responsavel ?? '', nota: lead.nota ?? '', faixa: lead.faixa ?? '', observacoes: lead.observacoes ?? '' };
  const [d, setD] = useState(inicial);
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  useEffect(() => { setD(inicial); }, [lead.atualizadoEm]); // eslint-disable-line react-hooks/exhaustive-deps
  const mudar = (k) => (e) => { setSalvo(false); setD((x) => ({ ...x, [k]: e.target.value })); };
  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    const corpo = { empresa: d.empresa, contato: nulo(d.contato), telefone: nulo(d.telefone), placeId: nulo(d.placeId), responsavel: nulo(d.responsavel), faixa: nulo(d.faixa), observacoes: nulo(d.observacoes), nota: String(d.nota) === '' ? null : Number(d.nota) };
    try {
      aoSalvar((await api.alterarLead(lead.id, corpo)).lead);
      setSalvo(true);
    } catch (x) {
      setErro({ campo: x.campo ?? '', texto: x.message });
    } finally {
      setSalvando(false);
    }
  }
  return (
    <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
      <Campo id="ed-empresa" rotulo="Empresa" erro={msgDe(erro, 'empresa')}><Input id="ed-empresa" value={d.empresa} onChange={mudar('empresa')} maxLength={200} required /></Campo>
      <Campo id="ed-contato" rotulo="Nome do contato" erro={msgDe(erro, 'contato')}><Input id="ed-contato" value={d.contato} onChange={mudar('contato')} maxLength={120} /></Campo>
      <Campo id="ed-tel" rotulo="Telefone" erro={msgDe(erro, 'telefone')}><Input id="ed-tel" inputMode="tel" value={d.telefone} onChange={mudar('telefone')} /></Campo>
      <Campo id="ed-place" rotulo="Place ID" erro={msgDe(erro, 'placeId')}><Input id="ed-place" value={d.placeId} onChange={mudar('placeId')} /></Campo>
      <Campo id="ed-resp" rotulo="Responsável" erro={msgDe(erro, 'responsavel')}><Input id="ed-resp" value={d.responsavel} onChange={mudar('responsavel')} maxLength={120} /></Campo>
      <Campo id="ed-nota" rotulo="Nota (0 a 100)" erro={msgDe(erro, 'nota')}><Input id="ed-nota" type="number" min={0} max={100} value={d.nota} onChange={mudar('nota')} /></Campo>
      <Campo id="ed-faixa" rotulo="Faixa" erro={msgDe(erro, 'faixa')}>
        <NativeSelect id="ed-faixa" value={d.faixa} onChange={mudar('faixa')}><NativeSelectOption value="">—</NativeSelectOption>{['Quente', 'Morno', 'Frio'].map((f) => <NativeSelectOption key={f} value={f}>{f}</NativeSelectOption>)}</NativeSelect>
      </Campo>
      <div className="sm:col-span-2"><Campo id="ed-obs" rotulo="Observações" erro={msgDe(erro, 'observacoes')}><Textarea id="ed-obs" rows={2} value={d.observacoes} onChange={mudar('observacoes')} /></Campo></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        {salvo && <span role="status" className="text-sm text-muted-foreground">Salvo.</span>}
        {erro.texto && !erro.campo && <span role="alert" className="text-sm text-destructive">{erro.texto}</span>}
      </div>
    </form>
  );
}

function AcoesLead({ lead, aoMudar }) {
  const [tipo, setTipo] = useState('empresa');
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function converter() {
    setOcupado(true);
    setErro('');
    try { await api.converterLead(lead.id, { tipo }); await aoMudar(); } catch (x) { setErro(x.message); } finally { setOcupado(false); }
  }
  async function sair() {
    setOcupado(true);
    setErro('');
    try { await api.optoutLead(lead.id); setConfirmando(false); await aoMudar(); } catch (x) { setErro(x.message); setConfirmando(false); } finally { setOcupado(false); }
  }

  if (lead.optOutEm) return <p className="text-sm text-muted-foreground">Este lead pediu para não ser contatado em {dia(lead.optOutEm)}. O contato foi apagado e só o código de verificação do telefone foi guardado, para barrar um novo cadastro.</p>;
  return (
    <div className="space-y-4">
      {lead.clienteId && <p className="text-sm">Este lead já virou cliente. <a href={`#/clientes/${lead.clienteId}`} className="text-brand-700 underline">Abrir o cliente</a></p>}
      {lead.final === 'Ganho' && !lead.clienteId && (
        <div className="flex flex-wrap items-end gap-3">
          <Campo id="cv-tipo" rotulo="Cliente é">
            <NativeSelect id="cv-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <NativeSelectOption value="empresa">Empresa</NativeSelectOption>
              <NativeSelectOption value="pessoa">Pessoa</NativeSelectOption>
            </NativeSelect>
          </Campo>
          <Button type="button" onClick={converter} disabled={ocupado}>{ocupado ? 'Convertendo…' : 'Converter em cliente'}</Button>
        </div>
      )}
      {lead.final !== 'Ganho' && (
        <div>
          <Button type="button" variant="destructive" onClick={() => setConfirmando(true)} disabled={ocupado}>Registrar opt-out</Button>
          <p className="mt-1 text-xs text-muted-foreground">Use quando a pessoa pedir para não ser mais contatada.</p>
        </div>
      )}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar opt-out de {lead.empresa}?</DialogTitle>
            <DialogDescription>Isto apaga telefone, nome do contato, Place ID, observações e as notas do histórico. Não tem volta, e esse telefone nunca mais poderá ser cadastrado.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="button" variant="destructive" onClick={sair} disabled={ocupado}>{ocupado ? 'Apagando…' : 'Sim, apagar o contato'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detalhe({ id }) {
  const [estado, setEstado] = useState('carregando');
  const [info, setInfo] = useState(null);
  const [funis, setFunis] = useState(null);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      const [l, f] = await Promise.all([api.lead(id), api.funis()]);
      setInfo(l);
      setFunis(f);
      setEstado('pronto');
    } catch (x) {
      setEstado(x.status === 404 ? 'nao-existe' : 'erro');
    }
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);

  const voltar = <a href="#/funil" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ArrowLeft aria-hidden="true" className="size-4" />Voltar ao funil</a>;
  if (estado === 'carregando') return <div className="space-y-4">{voltar}<ResourceState status="loading" title="Carregando o lead…" /></div>;
  if (estado === 'nao-existe') return <div className="space-y-4">{voltar}<ResourceState status="empty" title="Lead não encontrado" /></div>;
  if (estado === 'erro') return <div className="space-y-4">{voltar}<ResourceState status="error" title="Não foi possível carregar o lead" description="Confira a conexão e tente de novo." onRetry={carregar} /></div>;

  const { lead, eventos } = info;
  const funil = funis.itens.find((f) => f.id === lead.funilId);
  // Depois de mover ou registrar contato, a resposta traz o lead novo; o histórico vem da API de novo.
  const aposEvento = async () => { setInfo(await api.lead(id)); };

  return (
    <div className="space-y-5">
      {voltar}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{lead.empresa}</h1>
        <Badge>{lead.estagioNome}</Badge>
        <Badge variant="outline">{funil.nome}</Badge>
        {lead.faixa && <Badge variant="secondary">{lead.faixa}{lead.nota !== null ? ` ${lead.nota}` : ''}</Badge>}
        {lead.vencido && <Badge variant="destructive">Passo vencido</Badge>}
      </div>
      {lead.contatoApagadoEm && <p className="rounded-md border bg-muted/50 p-3 text-sm">O contato deste lead foi apagado em {dia(lead.contatoApagadoEm)} (perdido há mais de 12 meses).</p>}
      <Card>
        <CardHeader><CardTitle className="text-base">Situação</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {[['Origem', lead.origem], ['Base legal', lead.baseLegal], ['Consentimento', lead.consentimentoEm ? `${dia(lead.consentimentoEm)} · ${lead.consentimentoComo}` : ''], ['Contato', lead.contato], ['Telefone', lead.telefone],
              ['Responsável', lead.responsavel], ['Último contato', lead.ultimoContatoEm ? `${quando(lead.ultimoContatoEm)}${lead.ultimoContatoCanal ? ` · ${lead.ultimoContatoCanal}` : ''}` : ''],
              ['Próximo passo', lead.proximoPasso ? `${lead.proximoPasso}${lead.proximoPassoEm ? ` · ${dia(lead.proximoPassoEm)}` : ''}` : (lead.proximoPassoEm ? dia(lead.proximoPassoEm) : '')], ['Motivo da perda', lead.motivoPerda], ['Observações', lead.observacoes]].map(([r, v]) => (
              <div key={r}><dt className="text-xs text-muted-foreground">{r}</dt><dd className="whitespace-pre-wrap break-words">{v || <span className="text-muted-foreground">—</span>}</dd></div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Conversão e opt-out</CardTitle></CardHeader>
        <CardContent><AcoesLead lead={lead} aoMudar={aposEvento} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Mover de estágio</CardTitle></CardHeader>
        <CardContent><MoverEstagio lead={lead} funil={funil} aoMudar={aposEvento} /></CardContent>
      </Card>
      {!lead.optOutEm && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Registrar contato</CardTitle></CardHeader>
            <CardContent><RegistrarContato lead={lead} aoRegistrar={aposEvento} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Editar dados</CardTitle><CardDescription>Telefone e contato são dado pessoal: só ficam aqui, nunca na auditoria.</CardDescription></CardHeader>
            <CardContent><EditarLead lead={lead} aoSalvar={(l) => setInfo((i) => ({ ...i, lead: l }))} /></CardContent>
          </Card>
        </>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {[...eventos].reverse().map((e) => (
              <li key={e.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{e.tipo === 'criacao' ? `Cadastrado em ${e.para}` : e.tipo === 'estagio' ? `${e.de} → ${e.para}` : `Contato por ${e.canal}`}</span>
                  <span className="text-xs text-muted-foreground">{quando(e.ts)} · {e.usuario}</span>
                </div>
                {e.nota && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{e.nota}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

export function Funil({ id }) {
  return id ? <Detalhe id={id} /> : <Quadro />;
}
