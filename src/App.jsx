import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/layout/Shell';
import { Inicio } from '@/paginas/Inicio';
import { Clientes } from '@/paginas/Clientes';
import { PaginaContrato } from '@/paginas/Contratos';
import { api } from '@/api';

// Rota simples pelo endereço: #/ (início), #/clientes e #/clientes/<id>.
function lerRota() {
  const partes = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { pagina: partes[0] ?? 'inicio', id: partes[1] };
}

export default function App() {
  const [estado, setEstado] = useState('carregando');
  const [usuario, setUsuario] = useState(null);
  const [rota, setRota] = useState(lerRota);

  useEffect(() => {
    const aoMudar = () => setRota(lerRota());
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      setUsuario(await api.eu());
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <Shell usuario={usuario} atual={rota.pagina}>
      {rota.pagina === 'clientes' ? (
        <Clientes id={rota.id} />
      ) : rota.pagina === 'contratos' && rota.id ? (
        <PaginaContrato id={rota.id} />
      ) : (
        <Inicio estado={estado} usuario={usuario} aoTentarDeNovo={carregar} aoAlterado={setUsuario} />
      )}
    </Shell>
  );
}
