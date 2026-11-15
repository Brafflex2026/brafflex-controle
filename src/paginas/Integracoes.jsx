import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ResourceState } from '@/components/resource-state';
import { api } from '@/api';

const TIPOS = ['conta Meta', 'conta Google', 'pixel', 'página/IG', 'site', 'CRM do cliente'];
const DICAS = {
  'conta Meta': 'Ex.: act_1234567890 (só o número público da conta de anúncios)',
  'conta Google': 'Ex.: 123-456-7890 (id do cliente no Google Ads)',
  pixel: 'Ex.: 123456789012345 (id do pixel)',
  'página/IG': 'Ex.: nome ou endereço da página ou do perfil',
  site: 'Ex.: https://clinica.com.br',
  'CRM do cliente': 'Ex.: nome do sistema, como RD Station',
};
const ESTADOS = { pendente: 'Pendente', verificada: 'Verificada', revogada: 'Revogada' };
const hojeBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const dia = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

function Formulario({ aberto, aoFechar, contratoId, integracao, aoSalvo }) {
  const editando = Boolean(integracao);
  const [d, setD] = useState({});
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState({ campo: '', texto: '' });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setChave(crypto.randomUUID());
    setErro({ campo: '', texto: '' });
    setD({ tipo: integracao?.tipo ?? TIPOS[0], idExterno: integracao?.idExterno ?? '', dono: integracao?.dono ?? '', oQueFalta: integracao?.oQueFalta ?? '' });
  }, [aberto, integracao]);

  const mudar = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const nulo = (v) => ((v ?? '').trim() === '' ? null : v.trim());
  const aria = (k) => ({ 'aria-invalid': erro.campo === k ? 'true' : undefined, 'aria-describedby': erro.campo === k ? 'int-erro' : undefined });
  const msg = (k) => erro.campo === k && <p id="int-erro" role="alert" className="text-xs text-destructive">{erro.texto}</p>;

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro({ campo: '', texto: '' });
    const corpo = { idExterno: nulo(d.idExterno), dono: nulo(d.dono), oQueFalta: nulo(d.oQueFalta) };
    try {
      const salvo = editando ? await api.alterarIntegracao(integracao.id, corpo) : await api.criarIntegracao(contratoId, { tipo: d.tipo, ...corpo }, chave);
      aoSalvo(salvo);
      aoFechar();
    } catch (x) {
      setErro({ campo: x.campo ?? '', texto: x.message });
    } finally {
      setSalvando(false);
    }
  }

  const campos = ['tipo', 'idExterno', 'dono', 'oQueFalta'];
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar integração' : 'Nova integração'}</DialogTitle>
          <DialogDescription>Informe só o identificador público. Nunca senha, token ou chave de acesso: o app recusa.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="int-tipo" className="text-sm font-medium">Tipo <span aria-hidden="true">*</span></label>
            <NativeSelect id="int-tipo" value={d.tipo ?? TIPOS[0]} onChange={mudar('tipo')} disabled={editando}>
              {TIPOS.map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor="int-id" className="text-sm font-medium">Identificador</label>
            <Input id="int-id" value={d.idExterno ?? ''} onChange={mudar('idExterno')} maxLength={200} placeholder="a confirmar" {...aria('idExterno')} />
            <p className="text-xs text-muted-foreground">{DICAS[d.tipo ?? TIPOS[0]]}</p>
            {editando && integracao.estado === 'verificada' && <p className="text-xs text-muted-foreground">Trocar o identificador volta a integração para “pendente”.</p>}
            {msg('idExterno')}
          </div>
          <div className="space-y-1">
            <label htmlFor="int-dono" className="text-sm font-medium">Dono (quem controla)</label>
            <Input id="int-dono" value={d.dono ?? ''} onChange={mudar('dono')} maxLength={120} placeholder="a confirmar (cliente, agência ou nome)" {...aria('dono')} />
            {msg('dono')}
          </div>
          <div className="space-y-1">
            <label htmlFor="int-falta" className="text-sm font-medium">O que falta</label>
            <Input id="int-falta" value={d.oQueFalta ?? ''} onChange={mudar('oQueFalta')} maxLength={300} placeholder="ex.: pedir acesso de anunciante ao cliente" {...aria('oQueFalta')} />
            {msg('oQueFalta')}
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

function Verificar({ integracao, aoFechar, aoSalvo }) {
  const [data, setData] = useState(hojeBrasilia());
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (integracao) { setData(hojeBrasilia()); setErro(''); } }, [integracao]);

  async function enviar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      aoSalvo(await api.verificarIntegracao(integracao.id, data));
      aoFechar();
    } catch (x) {
      setErro(x.message);
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Dialog open={Boolean(integracao)} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como verificada</DialogTitle>
          <DialogDescription>Confirme que o identificador foi conferido no sistema de origem. Informe o dia da conferência (hoje ou antes).</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="ver-data" className="text-sm font-medium">Data da verificação</label>
            <Input id="ver-data" type="date" value={data} max={hojeBrasilia()} onChange={(e) => setData(e.target.value)} aria-invalid={erro ? 'true' : undefined} aria-describedby={erro ? 'ver-erro' : undefined} />
            {erro && <p id="ver-erro" role="alert" className="text-xs text-destructive">{erro}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Verificar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IntegracoesDoContrato({ contratoId, encerrado }) {
  const [estado, setEstado] = useState('carregando');
  const [dados, setDados] = useState({ itens: [], resumo: { pendente: 0, verificada: 0, revogada: 0 } });
  const [form, setForm] = useState(null); // null = fechado, {} = nova, {integracao} = editar
  const [verificando, setVerificando] = useState(null);
  const [falha, setFalha] = useState('');
  const [ocupada, setOcupada] = useState(null);

  // `silencioso`: recarrega a lista sem trocar a tela por "carregando", para não piscar nem perder o foco do teclado.
  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setEstado('carregando');
    try {
      setDados(await api.integracoes(contratoId));
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, [contratoId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function mudar(i, fn) {
    setFalha('');
    setOcupada(i.id);
    try {
      await fn(i.id);
      await carregar(true);
    } catch (e) {
      setFalha(e.message);
      if (e.status === 409) await carregar(true);
    } finally {
      setOcupada(null);
    }
  }

  const { resumo } = dados;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Integrações</CardTitle>
          <CardDescription>
            {estado === 'pronto' && dados.itens.length > 0
              ? `${resumo.verificada} verificada(s), ${resumo.pendente} pendente(s), ${resumo.revogada} revogada(s).`
              : 'Contas e sistemas ligados a este contrato. Só identificadores, nunca senha ou token.'}
          </CardDescription>
        </div>
        {!encerrado && estado === 'pronto' && <Button size="sm" onClick={() => setForm({})}><Plus aria-hidden="true" />Nova integração</Button>}
      </CardHeader>
      <CardContent>
        {falha && <p role="alert" className="mb-3 text-sm text-destructive">{falha}</p>}
        {estado === 'carregando' && <ResourceState status="loading" title="Carregando integrações…" />}
        {estado === 'erro' && <ResourceState status="error" title="Não foi possível carregar as integrações" description="Confira a conexão e tente de novo." onRetry={carregar} />}
        {estado === 'pronto' && dados.itens.length === 0 && <ResourceState status="empty" title="Nenhuma integração ainda" description={encerrado ? 'Contrato encerrado.' : 'Clique em “Nova integração” para ligar a primeira conta ou sistema.'} />}
        {estado === 'pronto' && dados.itens.length > 0 && (
          <ul className="divide-y">
            {dados.itens.map((i) => (
              <li key={i.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.tipo}</span>
                    <Badge variant="secondary">{ESTADOS[i.estado]}{i.estado === 'verificada' && i.verificadaEm ? ` em ${dia(i.verificadaEm)}` : ''}</Badge>
                  </div>
                  {!encerrado && (
                    <div className="flex flex-wrap gap-2">
                      {i.estado !== 'revogada' && <Button variant="ghost" size="sm" aria-label={`Editar ${i.tipo}`} onClick={() => setForm({ integracao: i })}><Pencil aria-hidden="true" />Editar</Button>}
                      {i.estado === 'pendente' && <Button variant="outline" size="sm" disabled={!i.idExterno || ocupada === i.id} aria-label={`Verificar ${i.tipo}`} aria-describedby={i.idExterno ? undefined : `dica-${i.id}`} onClick={() => setVerificando(i)}>Verificar</Button>}
                      {i.estado !== 'revogada' && <Button variant="outline" size="sm" disabled={ocupada === i.id} aria-label={`Revogar ${i.tipo}`} onClick={() => mudar(i, api.revogarIntegracao)}>Revogar</Button>}
                      {i.estado === 'revogada' && <Button variant="outline" size="sm" disabled={ocupada === i.id} aria-label={`Reativar ${i.tipo}`} onClick={() => mudar(i, api.reativarIntegracao)}>Reativar</Button>}
                    </div>
                  )}
                </div>
                {i.estado === 'pendente' && !i.idExterno && !encerrado && <p id={`dica-${i.id}`} className="text-xs text-muted-foreground">Preencha o identificador (botão Editar) para poder verificar.</p>}
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Identificador</dt><dd className="break-all">{i.idExterno ?? <span className="text-muted-foreground">a confirmar</span>}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Dono</dt><dd>{i.dono ?? <span className="text-muted-foreground">a confirmar</span>}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">O que falta</dt><dd>{i.oQueFalta ?? <span className="text-muted-foreground">nada informado</span>}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Formulario aberto={form !== null} aoFechar={() => setForm(null)} contratoId={contratoId} integracao={form?.integracao} aoSalvo={() => carregar(true)} />
      <Verificar integracao={verificando} aoFechar={() => setVerificando(null)} aoSalvo={() => carregar(true)} />
    </Card>
  );
}
