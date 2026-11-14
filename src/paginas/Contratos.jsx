import { useCallback, useEffect, useState } from 'react';
import { Plus, ArrowLeft, Pencil, ShieldCheck, ShieldOff, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ResourceState } from '@/components/resource-state';
import { api } from '@/api';
import { paraCentavos, deCentavos } from '@/lib/dinheiro';

const TIPOS = ['produto + marketing', 'só marketing', 'só produto'];
const ROTULOS = { escopo: 'Escopo', verbaCentavos: 'Verba', periodoInicio: 'Início do período', contatoAprovador: 'Contato que aprova' };

const aConfirmar = <span className="text-muted-foreground">a confirmar</span>;
const mostrar = (v) => (v === null || v === undefined || v === '' ? aConfirmar : v);
// Datas só com dia (período) vêm como AAAA-MM-DD; momentos (autorização, encerramento) vêm em UTC e viram dia de Brasília.
const dataBR = (iso) => {
  if (!iso) return null;
  if (iso.length === 10) return iso.split('-').reverse().join('/');
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
const reais = (centavos) => (centavos === null ? null : (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));


// ---------- formulário ----------
function FormularioContrato({ aberto, aoFechar, clienteId, contrato, aoSalvo }) {
  const editando = Boolean(contrato);
  const [dados, setDados] = useState({});
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setChave(crypto.randomUUID());
    setErro({ campo: '', texto: '' });
    setDados({
      marca: contrato?.marca ?? '',
      tipo: contrato?.tipo ?? TIPOS[0],
      escopo: contrato?.escopo ?? '',
      verba: deCentavos(contrato?.verbaCentavos),
      periodoInicio: contrato?.periodoInicio ?? '',
      periodoFim: contrato?.periodoFim ?? '',
      contatoAprovador: contrato?.contatoAprovador ?? '',
    });
  }, [aberto, contrato]);

  const mudar = (campo) => (e) => setDados((d) => ({ ...d, [campo]: e.target.value }));
  const erroDe = (campo) =>
    erro.campo === campo && (
      <p id="con-erro" role="alert" className="text-xs text-destructive">{erro.texto}</p>
    );
  const marca = (campo) => ({ 'aria-invalid': erro.campo === campo ? 'true' : undefined, 'aria-describedby': erro.campo === campo ? 'con-erro' : undefined });

  async function enviar(evento) {
    evento.preventDefault();
    setErro({ campo: '', texto: '' });
    const verba = paraCentavos(dados.verba ?? '');
    if (verba === undefined) {
      setErro({ campo: 'verbaCentavos', texto: 'Informe a verba em reais, com vírgula nos centavos. Exemplo: 1.500,00 (não use ponto nos centavos).' });
      return;
    }
    const vazioNulo = (v) => ((v ?? '').trim() === '' ? null : v.trim());
    const corpo = {
      marca: dados.marca,
      tipo: dados.tipo,
      escopo: vazioNulo(dados.escopo),
      verbaCentavos: verba,
      periodoInicio: vazioNulo(dados.periodoInicio),
      periodoFim: vazioNulo(dados.periodoFim),
      contatoAprovador: vazioNulo(dados.contatoAprovador),
    };
    setSalvando(true);
    try {
      const salvo = editando ? await api.alterarContrato(contrato.id, corpo) : await api.criarContrato(clienteId, corpo, chave);
      aoSalvo(salvo);
      aoFechar();
    } catch (e) {
      setErro({ campo: e.campo ?? '', texto: e.message });
    } finally {
      setSalvando(false);
    }
  }

  const campos = ['marca', 'tipo', 'escopo', 'verbaCentavos', 'periodoInicio', 'periodoFim', 'contatoAprovador'];
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar contrato' : 'Novo contrato'}</DialogTitle>
          <DialogDescription>Um contrato por marca. Só a marca e o tipo são obrigatórios; o resto fica “a confirmar”.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="con-marca" className="text-sm font-medium">Marca <span aria-hidden="true">*</span></label>
            <Input id="con-marca" value={dados.marca ?? ''} onChange={mudar('marca')} maxLength={120} required aria-required="true" {...marca('marca')} />
            {erroDe('marca')}
          </div>
          <div className="space-y-1">
            <label htmlFor="con-tipo" className="text-sm font-medium">Tipo <span aria-hidden="true">*</span></label>
            <NativeSelect id="con-tipo" value={dados.tipo ?? TIPOS[0]} onChange={mudar('tipo')}>
              {TIPOS.map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
            </NativeSelect>
            {erroDe('tipo')}
          </div>
          <div className="space-y-1">
            <label htmlFor="con-escopo" className="text-sm font-medium">Escopo</label>
            <Textarea id="con-escopo" value={dados.escopo ?? ''} onChange={mudar('escopo')} maxLength={500} placeholder="a confirmar" {...marca('escopo')} />
            {erroDe('escopo')}
          </div>
          <div className="space-y-1">
            <label htmlFor="con-verba" className="text-sm font-medium">Verba (R$)</label>
            <Input id="con-verba" inputMode="decimal" value={dados.verba ?? ''} onChange={mudar('verba')} placeholder="a confirmar" {...marca('verbaCentavos')} />
            {erroDe('verbaCentavos')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="con-inicio" className="text-sm font-medium">Início</label>
              <Input id="con-inicio" type="date" value={dados.periodoInicio ?? ''} onChange={mudar('periodoInicio')} {...marca('periodoInicio')} />
              {erroDe('periodoInicio')}
            </div>
            <div className="space-y-1">
              <label htmlFor="con-fim" className="text-sm font-medium">Fim (opcional)</label>
              <Input id="con-fim" type="date" value={dados.periodoFim ?? ''} onChange={mudar('periodoFim')} {...marca('periodoFim')} />
              {erroDe('periodoFim')}
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="con-contato" className="text-sm font-medium">Contato que aprova</label>
            <Input id="con-contato" value={dados.contatoAprovador ?? ''} onChange={mudar('contatoAprovador')} maxLength={120} placeholder="a confirmar (só o nome, sem e-mail ou telefone)" {...marca('contatoAprovador')} />
            {erroDe('contatoAprovador')}
          </div>
          {erro.texto && !campos.includes(erro.campo) && <p role="alert" className="text-sm text-destructive">{erro.texto}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- seção na página do cliente ----------
export function ContratosDoCliente({ clienteId, arquivado }) {
  const [estado, setEstado] = useState('carregando');
  const [itens, setItens] = useState([]);
  const [novo, setNovo] = useState(false);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      setItens(await api.contratosDoCliente(clienteId));
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, [clienteId]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Contratos</CardTitle>
          <CardDescription>Um por marca.</CardDescription>
        </div>
        {!arquivado && <Button size="sm" onClick={() => setNovo(true)}><Plus aria-hidden="true" />Novo contrato</Button>}
      </CardHeader>
      <CardContent>
        {estado === 'carregando' && <ResourceState status="loading" title="Carregando contratos…" />}
        {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar os contratos" description="Confira a conexão e tente de novo." onRetry={carregar} />}
        {estado === 'pronto' && itens.length === 0 && <ResourceState status="empty" title="Nenhum contrato ainda" description={arquivado ? 'Restaure o cliente para criar contratos.' : 'Clique em “Novo contrato” para criar o primeiro.'} />}
        {estado === 'pronto' && itens.length > 0 && (
          <ul className="divide-y">
            {itens.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <a href={`#/contratos/${k.id}`} className="font-medium text-brand-700 hover:underline">{k.marca}</a>
                  <p className="text-sm text-muted-foreground">{k.tipo}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {k.status === 'encerrado' ? <Badge variant="secondary">Encerrado</Badge> : <Badge variant="secondary">Ativo</Badge>}
                  <Badge variant="secondary">{k.leituraAutorizada ? 'Leitura de anúncios autorizada' : 'Sem leitura de anúncios'}</Badge>
                  {k.pendencias.length > 0 && <Badge variant="secondary">{k.pendencias.length} a confirmar</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <FormularioContrato aberto={novo} aoFechar={() => setNovo(false)} clienteId={clienteId} aoSalvo={() => carregar()} />
    </Card>
  );
}

// ---------- página do contrato ----------
function DialogoAutorizar({ aberto, aoFechar, contratoId, aoSalvo }) {
  const [quem, setQuem] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setQuem(''); setErro(''); } }, [aberto]);

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      aoSalvo(await api.autorizarLeitura(contratoId, quem));
      aoFechar();
    } catch (x) {
      setErro(x.message);
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar autorização de leitura</DialogTitle>
          <DialogDescription>O app só lê os anúncios deste contrato se houver uma autorização registrada. Informe quem autorizou. A data é gravada agora.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="aut-quem" className="text-sm font-medium">Quem autorizou <span aria-hidden="true">*</span></label>
            <Input id="aut-quem" value={quem} onChange={(e) => setQuem(e.target.value)} maxLength={120} required aria-required="true" aria-invalid={erro ? 'true' : undefined} aria-describedby={erro ? 'aut-erro' : undefined} />
            {erro && <p id="aut-erro" role="alert" className="text-xs text-destructive">{erro}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Registrar autorização'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoEncerrar({ aberto, aoFechar, contrato, aoSalvo }) {
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) setErro(''); }, [aberto]);
  async function confirmar() {
    setSalvando(true);
    setErro('');
    try {
      aoSalvo(await api.encerrarContrato(contrato.id));
      aoFechar();
    } catch (x) {
      setErro(x.message);
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar o contrato de {contrato?.marca}?</DialogTitle>
          <DialogDescription>O histórico fica guardado, mas o contrato não poderá mais ser editado e a leitura dos anúncios será revogada. Não dá para reabrir.</DialogDescription>
        </DialogHeader>
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          <Button type="button" onClick={confirmar} disabled={salvando}>{salvando ? 'Encerrando…' : 'Encerrar contrato'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaginaContrato({ id }) {
  const [estado, setEstado] = useState('carregando');
  const [k, setK] = useState(null);
  const [editando, setEditando] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [falha, setFalha] = useState('');

  const carregar = useCallback(async () => {
    setEstado('carregando');
    setFalha('');
    try {
      setK(await api.contrato(id));
      setEstado('pronto');
    } catch (e) {
      setEstado(e.status === 404 ? 'naoachou' : 'erro');
    }
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function revogar() {
    setFalha('');
    try {
      setK(await api.revogarLeitura(k.id));
    } catch (e) {
      setFalha(e.message);
    }
  }

  const encerrado = k?.status === 'encerrado';
  return (
    <div className="space-y-4">
      <a href={k ? `#/clientes/${k.clienteId}` : '#/clientes'} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ArrowLeft aria-hidden="true" className="size-4" />Voltar ao cliente</a>
      {estado === 'carregando' && <ResourceState status="loading" title="Carregando contrato…" />}
      {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar o contrato" description="Confira a conexão e tente de novo." onRetry={carregar} />}
      {estado === 'naoachou' && <ResourceState status="empty" title="Contrato não encontrado" />}
      {estado === 'pronto' && k && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {k.marca} <Badge variant="secondary" className="ml-2 align-middle">{encerrado ? 'Encerrado' : 'Ativo'}</Badge>
            </h1>
            {!encerrado && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditando(true)}><Pencil aria-hidden="true" />Editar</Button>
                <Button variant="outline" onClick={() => setEncerrando(true)}><Lock aria-hidden="true" />Encerrar</Button>
              </div>
            )}
          </div>
          {falha && <p role="alert" className="text-sm text-destructive">{falha}</p>}

          <Card>
            <CardHeader><CardTitle className="text-lg">Dados</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Tipo</dt><dd>{k.tipo}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{ROTULOS.verbaCentavos}</dt><dd>{k.verbaCentavos === null ? aConfirmar : reais(k.verbaCentavos)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{ROTULOS.periodoInicio}</dt><dd>{k.periodoInicio ? dataBR(k.periodoInicio) : aConfirmar}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Fim do período</dt><dd>{k.periodoFim ? dataBR(k.periodoFim) : <span className="text-muted-foreground">sem data de término</span>}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{ROTULOS.contatoAprovador}</dt><dd>{mostrar(k.contatoAprovador)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">{ROTULOS.escopo}</dt><dd className="whitespace-pre-wrap">{mostrar(k.escopo)}</dd></div>
                {encerrado && <div><dt className="text-xs text-muted-foreground">Encerrado em</dt><dd>{dataBR(k.encerradoEm)}</dd></div>}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Leitura dos anúncios</CardTitle>
              <CardDescription>Sem autorização registrada, o app não lê os anúncios deste contrato.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {k.leituraAutorizada ? (
                <p className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4" />Autorizada por {k.leituraAutorizadaPor} em {dataBR(k.leituraAutorizadaEm)}.</p>
              ) : (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <ShieldOff aria-hidden="true" className="size-4" />
                  {k.leituraRevogadaEm ? `Revogada em ${dataBR(k.leituraRevogadaEm)}.` : 'Nenhuma autorização registrada.'}
                </p>
              )}
              {!encerrado && (k.leituraAutorizada ? (
                <Button variant="outline" size="sm" onClick={revogar}>Revogar autorização</Button>
              ) : (
                <Button size="sm" onClick={() => setAutorizando(true)}>Registrar autorização</Button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Pendências</CardTitle></CardHeader>
            <CardContent>
              {k.pendencias.length === 0 ? (
                <p className="text-muted-foreground">Nada a confirmar.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5">{k.pendencias.map((p) => <li key={p}>{ROTULOS[p]}: a confirmar</li>)}</ul>
              )}
            </CardContent>
          </Card>

          <FormularioContrato aberto={editando} aoFechar={() => setEditando(false)} clienteId={k.clienteId} contrato={k} aoSalvo={setK} />
          <DialogoAutorizar aberto={autorizando} aoFechar={() => setAutorizando(false)} contratoId={k.id} aoSalvo={setK} />
          <DialogoEncerrar aberto={encerrando} aoFechar={() => setEncerrando(false)} contrato={k} aoSalvo={setK} />
        </>
      )}
    </div>
  );
}
