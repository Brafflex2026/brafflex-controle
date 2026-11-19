import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Upload } from 'lucide-react';
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
const rotuloNivel = (n) => (n === 2 ? 'Nível 2 (COVO)' : 'Nível 3 (Rodrigo)');
const vazio = (v) => v === null || v === undefined || v === '';

function Campo({ rotulo, valor }) {
  if (vazio(valor)) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm">{valor}</dd>
    </div>
  );
}

// ---------- formulários ----------
function NovaDecisao({ aberto, aoFechar, aoSalvo, propostas }) {
  const [d, setD] = useState({});
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setChave(crypto.randomUUID());
    setErro({ campo: '', texto: '' });
    setD({ data: hojeBrasilia(), nivel: '3', quem: 'Rodrigo', titulo: '', demandaRef: '', decisao: '', motivo: '', comoDesfazer: '', corrigeId: '', propostaId: '' });
  }, [aberto]);

  const mudar = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const aria = (k) => ({ 'aria-invalid': erro.campo === k ? 'true' : undefined, 'aria-describedby': erro.campo === k ? 'dec-erro' : undefined });
  const msg = (k) => erro.campo === k && <p id="dec-erro" role="alert" className="text-xs text-destructive">{erro.texto}</p>;

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    const corpo = { ...d, nivel: Number(d.nivel) };
    for (const k of ['demandaRef', 'motivo', 'comoDesfazer', 'corrigeId', 'propostaId']) if (!corpo[k]?.trim()) delete corpo[k];
    try {
      aoSalvo((await api.criarDecisao(corpo, chave)).decisao);
      aoFechar();
    } catch (x) {
      setErro({ campo: x.campo ?? '', texto: x.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova decisão</DialogTitle>
          <DialogDescription>Depois de registrada, não dá para alterar nem apagar. Para corrigir, registre outra decisão apontando a antiga.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="dec-titulo" className="text-xs font-medium">Título</label>
            <Input id="dec-titulo" value={d.titulo ?? ''} onChange={mudar('titulo')} maxLength={200} required {...aria('titulo')} />
            {msg('titulo')}
          </div>
          <div className="space-y-1">
            <label htmlFor="dec-data" className="text-xs font-medium">Data</label>
            <Input id="dec-data" type="date" max={hojeBrasilia()} value={d.data ?? ''} onChange={mudar('data')} required {...aria('data')} />
            {msg('data')}
          </div>
          <div className="space-y-1">
            <label htmlFor="dec-nivel" className="text-xs font-medium">Nível</label>
            <NativeSelect id="dec-nivel" value={d.nivel ?? '3'} onChange={mudar('nivel')}>
              <NativeSelectOption value="3">3 (Rodrigo decidiu)</NativeSelectOption>
              <NativeSelectOption value="2">2 (COVO executou e avisou)</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor="dec-quem" className="text-xs font-medium">Quem decidiu</label>
            <Input id="dec-quem" value={d.quem ?? ''} onChange={mudar('quem')} maxLength={120} required {...aria('quem')} />
            {msg('quem')}
          </div>
          <div className="space-y-1">
            <label htmlFor="dec-demanda" className="text-xs font-medium">Demanda (ex.: D-001)</label>
            <Input id="dec-demanda" value={d.demandaRef ?? ''} onChange={mudar('demandaRef')} maxLength={120} {...aria('demandaRef')} />
            {msg('demandaRef')}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="dec-decisao" className="text-xs font-medium">Decisão</label>
            <Textarea id="dec-decisao" rows={4} value={d.decisao ?? ''} onChange={mudar('decisao')} required {...aria('decisao')} />
            {msg('decisao')}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="dec-motivo" className="text-xs font-medium">Motivo</label>
            <Textarea id="dec-motivo" rows={2} value={d.motivo ?? ''} onChange={mudar('motivo')} {...aria('motivo')} />
            {msg('motivo')}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="dec-desfazer" className="text-xs font-medium">Como desfazer</label>
            <Input id="dec-desfazer" value={d.comoDesfazer ?? ''} onChange={mudar('comoDesfazer')} {...aria('comoDesfazer')} />
            {msg('comoDesfazer')}
          </div>
          <div className="space-y-1">
            <label htmlFor="dec-prop" className="text-xs font-medium">Proposta que esta decisão trata</label>
            <NativeSelect id="dec-prop" value={d.propostaId ?? ''} onChange={mudar('propostaId')}>
              <NativeSelectOption value="">Nenhuma</NativeSelectOption>
              {propostas.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.id} — {p.titulo.slice(0, 50)}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor="dec-corrige" className="text-xs font-medium">Corrige a decisão (ex.: DEC-004)</label>
            <Input id="dec-corrige" value={d.corrigeId ?? ''} onChange={mudar('corrigeId')} {...aria('corrigeId')} />
            {msg('corrigeId')}
          </div>
          {erro.texto && !erro.campo && <p role="alert" className="text-sm text-destructive sm:col-span-2">{erro.texto}</p>}
          <DialogFooter className="sm:col-span-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar decisão'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NovaProposta({ aberto, aoFechar, aoSalvo }) {
  const [d, setD] = useState({ titulo: '', texto: '' });
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    setChave(crypto.randomUUID());
    setErro({ campo: '', texto: '' });
    setD({ titulo: '', texto: '' });
  }, [aberto]);

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    try {
      aoSalvo((await api.criarProposta(d, chave)).proposta);
      aoFechar();
    } catch (x) {
      setErro({ campo: x.campo ?? '', texto: x.message });
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova proposta</DialogTitle>
          <DialogDescription>Depois de registrada, não dá para alterar nem apagar. A decisão que a aprovar aponta para ela.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="pr-titulo" className="text-xs font-medium">Título</label>
            <Input id="pr-titulo" value={d.titulo} onChange={(e) => setD((x) => ({ ...x, titulo: e.target.value }))} maxLength={200} required aria-invalid={erro.campo === 'titulo' ? 'true' : undefined} />
          </div>
          <div className="space-y-1">
            <label htmlFor="pr-texto" className="text-xs font-medium">Texto</label>
            <Textarea id="pr-texto" rows={8} value={d.texto} onChange={(e) => setD((x) => ({ ...x, texto: e.target.value }))} required aria-invalid={erro.campo === 'texto' ? 'true' : undefined} />
          </div>
          {erro.texto && <p role="alert" className="text-sm text-destructive">{erro.texto}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar proposta'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- linhas que abrem ----------
function LinhaDecisao({ item }) {
  const [aberto, setAberto] = useState(false);
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState(false);
  async function alternar() {
    setAberto((a) => !a);
    if (!info && !aberto) {
      try { setInfo(await api.decisao(item.id)); } catch { setErro(true); }
    }
  }
  const d = info?.decisao;
  return (
    <li className="rounded-md border bg-card">
      <button type="button" onClick={alternar} aria-expanded={aberto} className="flex w-full items-start gap-2 p-3 text-left text-sm">
        {aberto ? <ChevronDown aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="font-medium">{item.id} — {item.titulo}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            <Badge variant="secondary">{dia(item.data)}</Badge>
            <Badge variant={item.nivel === 3 ? 'default' : 'outline'}>{rotuloNivel(item.nivel)}</Badge>
            {item.demandaRef && <Badge variant="outline">{item.demandaRef}</Badge>}
            {item.corrigeId && <Badge variant="outline">Corrige {item.corrigeId}</Badge>}
            {item.propostaId && <Badge variant="outline">{item.propostaId}</Badge>}
          </span>
        </span>
      </button>
      {aberto && (
        <div className="border-t bg-muted/40 px-4 py-3">
          {erro && <p role="alert" className="text-sm text-destructive">Não foi possível abrir esta decisão.</p>}
          {!d && !erro && <p role="status" className="text-sm text-muted-foreground">Carregando…</p>}
          {d && (
            <dl className="space-y-3">
              <Campo rotulo="Quem decidiu" valor={d.quem} />
              <Campo rotulo="Decisão" valor={d.decisao} />
              <Campo rotulo="Motivo" valor={d.motivo} />
              <Campo rotulo="Como desfazer" valor={d.comoDesfazer} />
              <Campo rotulo="Observações" valor={d.observacoes} />
              <Campo rotulo="Corrigida por" valor={info.corrigidaPor.join(', ')} />
              <p className="text-xs text-muted-foreground">{d.origem === 'importada' ? 'Importada dos arquivos do repositório' : `Registrada por ${d.criadoPor}`}</p>
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

function LinhaProposta({ item }) {
  const [aberto, setAberto] = useState(false);
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState(false);
  async function alternar() {
    setAberto((a) => !a);
    if (!info && !aberto) {
      try { setInfo(await api.proposta(item.id)); } catch { setErro(true); }
    }
  }
  return (
    <li className="rounded-md border bg-card">
      <button type="button" onClick={alternar} aria-expanded={aberto} className="flex w-full items-start gap-2 p-3 text-left text-sm">
        {aberto ? <ChevronDown aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="font-medium">{item.id} — {item.titulo}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            <Badge variant="secondary">{dia(item.criadoEm)}</Badge>
            {item.decisaoId && <Badge variant="outline">Decidida em {item.decisaoId}</Badge>}
          </span>
        </span>
      </button>
      {aberto && (
        <div className="border-t bg-muted/40 px-4 py-3">
          {erro && <p role="alert" className="text-sm text-destructive">Não foi possível abrir esta proposta.</p>}
          {!info && !erro && <p role="status" className="text-sm text-muted-foreground">Carregando…</p>}
          {info && (
            <div className="space-y-3">
              <p className="whitespace-pre-wrap break-words text-sm">{info.proposta.texto}</p>
              {info.decisoes.length > 0 && <p className="text-xs text-muted-foreground">Decisões ligadas: {info.decisoes.map((x) => x.id).join(', ')}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------- importação única ----------
function Importar({ aoImportar }) {
  const [arq, setArq] = useState({ decisoes: '', propostas: '' });
  const [previa, setPrevia] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function ler(campo, e) {
    const f = e.target.files?.[0];
    setPrevia(null);
    setErro('');
    if (!f) return setArq((a) => ({ ...a, [campo]: '' }));
    if (f.size > 300_000) return setErro('Esse arquivo é grande demais para ser um registro de decisões.');
    setArq((a) => ({ ...a, [campo]: '' }));
    const texto = await f.text();
    setArq((a) => ({ ...a, [campo]: texto }));
  }
  async function ver() {
    setOcupado(true);
    setErro('');
    try { setPrevia(await api.previaImportacao(arq)); } catch (x) { setPrevia(null); setErro(x.message); } finally { setOcupado(false); }
  }
  async function importar() {
    setOcupado(true);
    setErro('');
    try {
      await api.importarDecisoes(arq, { decisoes: previa.decisoes.total, propostas: previa.propostas.total });
      aoImportar();
    } catch (x) { setErro(x.message); } finally { setOcupado(false); }
  }
  const pode = previa && !previa.jaImportado && previa.problemas.length === 0;

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Upload aria-hidden="true" className="size-4" />Importar os registros do repositório (uma vez só)</CardTitle>
        <CardDescription>Escolha os dois arquivos, confira a prévia e só então importe. Depois disso, o app é a fonte e esta opção some.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="imp-dec" className="text-xs font-medium">decisoes.md</label>
            <Input id="imp-dec" type="file" accept=".md,text/markdown,text/plain" onChange={(e) => ler('decisoes', e)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="imp-prop" className="text-xs font-medium">propostas-de-mudanca.md</label>
            <Input id="imp-prop" type="file" accept=".md,text/markdown,text/plain" onChange={(e) => ler('propostas', e)} />
          </div>
        </div>
        <Button type="button" variant="outline" onClick={ver} disabled={!arq.decisoes || !arq.propostas || ocupado}>{ocupado ? 'Lendo…' : 'Ver a prévia'}</Button>
        {previa && (
          <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
            <p className="font-medium">A prévia encontrou {previa.decisoes.total} decisões e {previa.propostas.total} propostas.</p>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {previa.decisoes.itens.map((i) => <li key={i.id}>{i.id} — {i.titulo}</li>)}
              {previa.propostas.itens.map((i) => <li key={i.id}>{i.id} — {i.titulo}{i.decisaoId ? ` (decidida em ${i.decisaoId})` : ''}</li>)}
            </ul>
            {previa.avisos.length > 0 && <p className="text-xs text-muted-foreground">Avisos: {previa.avisos.map((a) => `${a.id}: ${a.motivo}`).join('; ')}</p>}
            {previa.problemas.length > 0 && (
              <div role="alert" className="text-destructive">
                <p className="font-medium">Há problemas; a importação está travada:</p>
                <ul className="list-disc pl-5 text-xs">{previa.problemas.map((p, i) => <li key={i}>{p.id}: {p.motivo}</li>)}</ul>
              </div>
            )}
            {previa.jaImportado && <p role="alert" className="text-destructive">A importação já foi feita.</p>}
            <Button type="button" onClick={importar} disabled={!pode || ocupado}>Importar {previa.decisoes.total} decisões e {previa.propostas.total} propostas</Button>
          </div>
        )}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      </CardContent>
    </Card>
  );
}

// ---------- página ----------
export function Decisoes() {
  const [aba, setAba] = useState('decisoes');
  const [estado, setEstado] = useState('carregando');
  const [decs, setDecs] = useState([]);
  const [props, setProps] = useState([]);
  const [busca, setBusca] = useState('');
  const [nivel, setNivel] = useState('');
  const [aplicados, setAplicados] = useState({ q: '', nivel: '' });
  const [novaDec, setNovaDec] = useState(false);
  const [novaProp, setNovaProp] = useState(false);
  const [importado, setImportado] = useState(true); // o painel só aparece quando o servidor diz que ainda não houve importação

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      const [d, p] = await Promise.all([api.decisoes(aplicados), api.propostas()]);
      setDecs(d.itens);
      setProps(p.itens);
      setImportado(d.importada);
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, [aplicados]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Decisões e propostas</h1>
        <div className="flex gap-2">
          <Button onClick={() => setNovaDec(true)}><Plus aria-hidden="true" />Nova decisão</Button>
          <Button variant="outline" onClick={() => setNovaProp(true)}><Plus aria-hidden="true" />Nova proposta</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Registros só de acréscimo: não se altera nem se apaga. Para corrigir, registre uma nova decisão apontando a antiga.</p>

      {estado === 'pronto' && !importado && <Importar aoImportar={() => { setImportado(true); carregar(); }} />}

      <div role="tablist" aria-label="Decisões ou propostas" className="flex gap-2">
        {[['decisoes', `Decisões (${decs.length})`], ['propostas', `Propostas (${props.length})`]].map(([id, rotulo]) => (
          <button key={id} role="tab" type="button" aria-selected={aba === id} onClick={() => setAba(id)}
            className={aba === id ? 'rounded-md bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700' : 'rounded-md px-3 py-1.5 text-sm hover:bg-muted'}>{rotulo}</button>
        ))}
      </div>

      {aba === 'decisoes' && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setAplicados({ q: busca, nivel }); }}>
          <div className="space-y-1">
            <label htmlFor="dec-busca" className="text-xs font-medium">Buscar</label>
            <Input id="dec-busca" className="w-56" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="dec-f-nivel" className="text-xs font-medium">Nível</label>
            <NativeSelect id="dec-f-nivel" value={nivel} onChange={(e) => setNivel(e.target.value)}>
              <NativeSelectOption value="">Todos</NativeSelectOption>
              <NativeSelectOption value="3">3 (Rodrigo)</NativeSelectOption>
              <NativeSelectOption value="2">2 (COVO)</NativeSelectOption>
            </NativeSelect>
          </div>
          <Button type="submit">Filtrar</Button>
        </form>
      )}

      {estado === 'carregando' && <ResourceState status="loading" title="Carregando…" />}
      {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar" description="Confira a conexão e tente de novo." onRetry={carregar} />}
      {estado === 'pronto' && aba === 'decisoes' && (decs.length === 0
        ? <ResourceState status="empty" title="Nenhuma decisão" description="Registre a primeira em “Nova decisão” ou importe os arquivos do repositório." />
        : <ul className="space-y-2">{decs.map((i) => <LinhaDecisao key={i.id} item={i} />)}</ul>)}
      {estado === 'pronto' && aba === 'propostas' && (props.length === 0
        ? <ResourceState status="empty" title="Nenhuma proposta" description="Registre a primeira em “Nova proposta” ou importe os arquivos do repositório." />
        : <ul className="space-y-2">{props.map((i) => <LinhaProposta key={i.id} item={i} />)}</ul>)}

      <NovaDecisao aberto={novaDec} aoFechar={() => setNovaDec(false)} aoSalvo={carregar} propostas={props} />
      <NovaProposta aberto={novaProp} aoFechar={() => setNovaProp(false)} aoSalvo={carregar} />
    </div>
  );
}
