import { useCallback, useEffect, useState } from 'react';
import { Plus, ArrowLeft, Archive, ArchiveRestore, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ResourceState } from '@/components/resource-state';
import { api } from '@/api';
import { ContratosDoCliente } from '@/paginas/Contratos';

const ROTULOS = {
  profissao: 'Profissão',
  conselho: 'Conselho',
  registroUf: 'UF do registro',
  registroNumero: 'Número do registro',
  rqe: 'RQE',
  saude: 'Área da saúde',
};
const SAUDE = { sim: 'Sim', nao: 'Não' };

const aConfirmar = <span className="text-muted-foreground">a confirmar</span>;
const mostrar = (v) => (v === null || v === undefined ? aConfirmar : v === '' ? <span className="text-muted-foreground">não se aplica</span> : v);

// ---------- formulário (criar e editar) ----------
function FormularioCliente({ aberto, aoFechar, cliente, aoSalvo }) {
  const editando = Boolean(cliente);
  const [dados, setDados] = useState({});
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setChave(crypto.randomUUID());
    setErro({ campo: '', texto: '' });
    // No banco: null = a confirmar, '' = não se aplica. No formulário: '' = a confirmar, '-' = não se aplica.
    const doBanco = (v) => (v === null || v === undefined ? '' : v === '' ? '-' : v);
    setDados({
      nome: cliente?.nome ?? '',
      tipo: cliente?.tipo ?? 'empresa',
      profissao: doBanco(cliente?.profissao),
      conselho: doBanco(cliente?.conselho),
      registroUf: doBanco(cliente?.registroUf),
      registroNumero: doBanco(cliente?.registroNumero),
      rqe: doBanco(cliente?.rqe),
      saude: cliente?.saude ?? '',
    });
  }, [aberto, cliente]);

  // Erro de um campo que não está na tela vira mensagem geral, para nunca ficar invisível.
  const camposVisiveis = ['nome', 'profissao', 'conselho', 'registroUf', 'registroNumero', ...(dados.saude === 'sim' ? ['rqe'] : [])];
  const mudar = (campo) => (e) => setDados((d) => ({ ...d, [campo]: e.target.value }));

  async function enviar(evento) {
    evento.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    // Em branco (ou só espaços) = "a confirmar" (null). Um traço = "não se aplica" (texto vazio no banco).
    // O RQE só existe quando a área é saúde; fora disso nem é enviado, para não apagar nem barrar nada escondido.
    const corpo = { nome: dados.nome, tipo: dados.tipo, saude: dados.saude || null };
    const campos = ['profissao', 'conselho', 'registroUf', 'registroNumero', ...(dados.saude === 'sim' ? ['rqe'] : [])];
    for (const k of campos) {
      const v = (dados[k] ?? '').trim();
      corpo[k] = v === '' ? null : v === '-' ? '' : v;
    }
    try {
      const salvo = editando ? await api.alterarCliente(cliente.id, corpo) : await api.criarCliente(corpo, chave);
      aoSalvo(salvo);
      aoFechar();
    } catch (e) {
      setErro({ campo: e.campo ?? '', texto: e.message });
    } finally {
      setSalvando(false);
    }
  }

  const campoTexto = (campo, rotulo, extra = {}) => (
    <div className="space-y-1">
      <label htmlFor={`cli-${campo}`} className="text-sm font-medium">{rotulo}</label>
      <Input
        id={`cli-${campo}`}
        value={dados[campo] ?? ''}
        onChange={mudar(campo)}
        maxLength={120}
        aria-invalid={erro.campo === campo ? 'true' : undefined}
        aria-describedby={erro.campo === campo ? 'cli-erro' : undefined}
        placeholder="a confirmar"
        {...extra}
      />
      {erro.campo === campo && <p id="cli-erro" role="alert" className="text-xs text-destructive">{erro.texto}</p>}
    </div>
  );

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
          <DialogDescription>
            Só o nome e o tipo são obrigatórios. O que ficar em branco aparece como “a confirmar”. Digite um traço (-) onde não se aplica.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="cli-nome" className="text-sm font-medium">Nome <span aria-hidden="true">*</span></label>
            <Input
              id="cli-nome"
              value={dados.nome ?? ''}
              onChange={mudar('nome')}
              maxLength={120}
              required
              aria-required="true"
              aria-invalid={erro.campo === 'nome' ? 'true' : undefined}
              aria-describedby={erro.campo === 'nome' ? 'cli-erro' : undefined}
            />
            {erro.campo === 'nome' && <p id="cli-erro" role="alert" className="text-xs text-destructive">{erro.texto}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="cli-tipo" className="text-sm font-medium">Tipo <span aria-hidden="true">*</span></label>
            <NativeSelect id="cli-tipo" value={dados.tipo ?? 'empresa'} onChange={mudar('tipo')}>
              <NativeSelectOption value="empresa">Empresa</NativeSelectOption>
              <NativeSelectOption value="pessoa">Pessoa</NativeSelectOption>
            </NativeSelect>
          </div>
          {campoTexto('profissao', 'Profissão')}
          <div className="grid grid-cols-2 gap-3">
            {campoTexto('conselho', 'Conselho (CRM, CRO…)')}
            {campoTexto('registroUf', 'UF do registro')}
          </div>
          {campoTexto('registroNumero', 'Número do registro')}
          <div className="space-y-1">
            <label htmlFor="cli-saude" className="text-sm font-medium">Área da saúde</label>
            <NativeSelect id="cli-saude" value={dados.saude ?? ''} onChange={mudar('saude')}>
              <NativeSelectOption value="">A confirmar</NativeSelectOption>
              <NativeSelectOption value="sim">Sim</NativeSelectOption>
              <NativeSelectOption value="nao">Não</NativeSelectOption>
            </NativeSelect>
          </div>
          {dados.saude === 'sim' && campoTexto('rqe', 'RQE')}
          {erro.texto && !camposVisiveis.includes(erro.campo) && <p role="alert" className="text-sm text-destructive">{erro.texto}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- lista ----------
function ListaClientes() {
  const [estado, setEstado] = useState('carregando');
  const [itens, setItens] = useState([]);
  const [arquivados, setArquivados] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [novo, setNovo] = useState(false);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      setItens(await api.clientes(arquivados));
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, [arquivados]);
  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = itens.filter((c) => c.nome.toLowerCase().includes(filtro.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        <Button onClick={() => setNovo(true)}><Plus aria-hidden="true" />Novo cliente</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="filtro-clientes" className="sr-only">Buscar cliente pelo nome</label>
        <Input id="filtro-clientes" className="max-w-xs" placeholder="Buscar pelo nome" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={arquivados} onChange={(e) => setArquivados(e.target.checked)} />
          Mostrar arquivados
        </label>
      </div>

      {estado === 'carregando' && <ResourceState status="loading" title="Carregando clientes…" />}
      {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar os clientes" description="Confira a conexão e tente de novo." onRetry={carregar} />}
      {estado === 'pronto' && itens.length === 0 && (
        <ResourceState status="empty" title="Nenhum cliente ainda" description="Clique em “Novo cliente” para cadastrar o primeiro." />
      )}
      {estado === 'pronto' && itens.length > 0 && visiveis.length === 0 && (
        <ResourceState status="empty" title="Nenhum cliente com esse nome" />
      )}
      {estado === 'pronto' && visiveis.length > 0 && (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="hidden sm:table-cell">Tipo</TableHead>
                <TableHead className="hidden md:table-cell">Profissão</TableHead>
                <TableHead>Pendências</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <a href={`#/clientes/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.nome}</a>
                    {c.arquivadoEm && <Badge variant="secondary" className="ml-2">Arquivado</Badge>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{c.tipo === 'pessoa' ? 'Pessoa' : 'Empresa'}</TableCell>
                  <TableCell className="hidden md:table-cell">{mostrar(c.profissao)}</TableCell>
                  <TableCell>{c.totalPendencias === 0 ? <span className="text-muted-foreground">nenhuma</span> : <Badge variant="secondary">{c.totalPendencias} a confirmar</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FormularioCliente aberto={novo} aoFechar={() => setNovo(false)} aoSalvo={() => carregar()} />
    </div>
  );
}

// ---------- página do cliente ----------
function PaginaCliente({ id }) {
  const [estado, setEstado] = useState('carregando');
  const [c, setC] = useState(null);
  const [editando, setEditando] = useState(false);
  const [falha, setFalha] = useState('');

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      setC(await api.cliente(id));
      setEstado('pronto');
    } catch (e) {
      setEstado(e.status === 404 ? 'naoachou' : 'erro');
    }
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function alternarArquivo() {
    setFalha('');
    try {
      setC(await (c.arquivadoEm ? api.restaurarCliente(c.id) : api.arquivarCliente(c.id)));
    } catch (e) {
      setFalha(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <a href="#/clientes" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ArrowLeft aria-hidden="true" className="size-4" />Clientes</a>
      {estado === 'carregando' && <ResourceState status="loading" title="Carregando cliente…" />}
      {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar o cliente" description="Confira a conexão e tente de novo." onRetry={carregar} />}
      {estado === 'naoachou' && <ResourceState status="empty" title="Cliente não encontrado" description="Ele pode ter sido removido ou o endereço está errado." />}
      {estado === 'pronto' && c && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {c.nome} {c.arquivadoEm && <Badge variant="secondary" className="ml-2 align-middle">Arquivado</Badge>}
            </h1>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditando(true)}><Pencil aria-hidden="true" />Editar</Button>
              <Button variant="outline" onClick={alternarArquivo}>
                {c.arquivadoEm ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                {c.arquivadoEm ? 'Restaurar' : 'Arquivar'}
              </Button>
            </div>
          </div>
          {falha && <p role="alert" className="text-sm text-destructive">{falha}</p>}

          <Card>
            <CardHeader><CardTitle className="text-lg">Dados</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Tipo</dt><dd>{c.tipo === 'pessoa' ? 'Pessoa' : 'Empresa'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Cliente desde</dt><dd>{c.desde ?? aConfirmar}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{ROTULOS.profissao}</dt><dd>{mostrar(c.profissao)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{ROTULOS.conselho}</dt><dd>{mostrar(c.conselho)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{ROTULOS.registroUf}</dt><dd>{mostrar(c.registroUf)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{ROTULOS.registroNumero}</dt><dd>{mostrar(c.registroNumero)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{ROTULOS.saude}</dt><dd>{c.saude ? SAUDE[c.saude] : aConfirmar}</dd></div>
                {c.saude === 'sim' && <div><dt className="text-xs text-muted-foreground">{ROTULOS.rqe}</dt><dd>{mostrar(c.rqe)}</dd></div>}
              </dl>
            </CardContent>
          </Card>

          <ContratosDoCliente clienteId={c.id} arquivado={Boolean(c.arquivadoEm)} />

          <Card>
            <CardHeader><CardTitle className="text-lg">Pendências</CardTitle></CardHeader>
            <CardContent>
              {c.pendencias.length === 0 ? (
                <p className="text-muted-foreground">Nada a confirmar.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  {c.pendencias.map((p) => <li key={p}>{ROTULOS[p]}: a confirmar</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          <FormularioCliente aberto={editando} aoFechar={() => setEditando(false)} cliente={c} aoSalvo={(novo) => setC(novo)} />
        </>
      )}
    </div>
  );
}

export function Clientes({ id }) {
  return id ? <PaginaCliente id={id} /> : <ListaClientes />;
}
