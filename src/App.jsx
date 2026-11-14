import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/layout/Shell';
import { Inicio } from '@/paginas/Inicio';
import { api } from '@/api';

export default function App() {
  const [estado, setEstado] = useState('carregando');
  const [usuario, setUsuario] = useState(null);

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
    <Shell usuario={usuario}>
      <Inicio estado={estado} usuario={usuario} aoTentarDeNovo={carregar} aoAlterado={setUsuario} />
    </Shell>
  );
}
