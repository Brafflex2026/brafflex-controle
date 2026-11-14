import { useState } from 'react';
import { Pencil, CircleCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ResourceState } from '@/components/resource-state';
import { api } from '@/api';

const papeis = { rodrigo: 'Rodrigo', revisor_humano: 'Revisor humano' };

const modulos = [
  ['Clientes e contratos', 'Cada marca como um contrato, com o que está autorizado.'],
  ['Demandas e trilha', 'Onde está cada demanda, de qual cliente, com a linha do tempo.'],
  ['Funil e CRM', 'Leads de todas as ofertas, com origem e base legal.'],
  ['Anúncios', 'Gasto e resultados da Meta e do Google, só leitura.'],
  ['Desempenho', 'Indicadores da agência calculados a partir da trilha.'],
];

export function Inicio({ estado, usuario, aoTentarDeNovo, aoAlterado }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState('');

  function abrir() {
    setNome(usuario.nome);
    setErro('');
    setAberto(true);
  }

  async function salvar(evento) {
    evento.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      const novo = await api.alterarNome(nome);
      aoAlterado(novo);
      setAberto(false);
      setAviso('Nome atualizado.');
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Início</h1>

      {estado === 'carregando' && (
        <div role="status" aria-live="polite" aria-label="Carregando" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-md bg-muted motion-safe:animate-pulse" />
          ))}
        </div>
      )}
      {estado === 'erro' && (
        <ResourceState
          status="error"
          title="Não foi possível carregar seus dados"
          description="Confira a conexão e tente de novo."
          onRetry={aoTentarDeNovo}
        />
      )}

      {estado === 'pronto' && usuario && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Olá, {usuario.nome}</CardTitle>
              <CardDescription>Você entrou como {usuario.email}.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary">{papeis[usuario.papel] ?? usuario.papel}</Badge>
              <Button variant="outline" size="sm" onClick={abrir}>
                <Pencil aria-hidden="true" />
                Editar nome
              </Button>
              <p role="status" aria-live="polite" className="flex min-h-5 items-center gap-1 text-muted-foreground">
                {aviso && (
                  <>
                    <CircleCheck aria-hidden="true" className="size-4" />
                    {aviso}
                  </>
                )}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">O que vem por aí</CardTitle>
              <CardDescription>Os módulos do app entram aos poucos, um de cada vez.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {modulos.map(([titulo, descricao]) => (
                  <li key={titulo} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{titulo}</p>
                      <p className="text-muted-foreground">{descricao}</p>
                    </div>
                    <Badge variant="secondary" className="self-start sm:self-center">Em breve</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar nome</DialogTitle>
            <DialogDescription>Este é o nome que aparece para você no app e na auditoria.</DialogDescription>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label htmlFor="nome" className="text-sm font-medium">
                Nome <span aria-hidden="true">*</span>
              </label>
              <Input
                id="nome"
                name="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={120}
                required
                aria-required="true"
                aria-invalid={erro ? 'true' : undefined}
                aria-describedby={erro ? 'nome-erro' : undefined}
                autoComplete="name"
              />
              {erro && (
                <p id="nome-erro" role="alert" className="text-xs text-destructive">
                  {erro}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancelar</Button>
              </DialogClose>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar alterações'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
