import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';

const ModulosContext = createContext(null);

export function ModulosProvider({ children }) {
  const { usuario, estadoAutenticacion } = useAuth();
  const [modulos, setModulos] = useState(null); // null = todavía no cargó
  const [error, setError] = useState(null);

  const refrescar = useCallback(() => {
    if (!usuario || estadoAutenticacion === AUTH_OFFLINE) return;
    setError(null);
    api.listarModulos().then(setModulos).catch((err) => setError(err.message));
  }, [usuario, estadoAutenticacion]);

  useEffect(() => { refrescar(); }, [refrescar]);

  // Mientras carga (o si algo falla), se asume todo activo — así nunca
  // se le oculta nada a nadie por un error de red. El error queda
  // expuesto igual (ver "error" abajo) para que quien vea la pantalla
  // de Configuración sepa que algo falló, en vez de un "Cargando..."
  // silencioso para siempre.
  function activo(clave) {
    if (!modulos) return true;
    const m = modulos.find((x) => x.clave === clave);
    return m ? m.activo : true;
  }

  return (
    <ModulosContext.Provider value={{ modulos, activo, refrescar, error }}>
      {children}
    </ModulosContext.Provider>
  );
}

export function useModulos() {
  return useContext(ModulosContext);
}
