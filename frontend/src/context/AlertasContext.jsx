import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { actualizarResumenPorCambioTarea, totalAlertasActivas, totalTareasActivas } from '../alertasBadges.js';

const AlertasContext = createContext(null);

export function AlertasProvider({ children }) {
  const { usuario, estadoAutenticacion } = useAuth();
  const [resumen, setResumen] = useState(null);

  const refrescar = useCallback(() => {
    if (!usuario || estadoAutenticacion === AUTH_OFFLINE) return;
    return api.resumenAlertas().then(setResumen).catch(() => {});
  }, [usuario, estadoAutenticacion]);

  useEffect(() => {
    refrescar();
    // Se refresca solo cada 5 minutos mientras la app está abierta
    const intervalo = setInterval(refrescar, 5 * 60 * 1000);
    return () => clearInterval(intervalo);
  }, [refrescar]);

  const total = totalAlertasActivas(resumen);
  const registrarCambioTarea = useCallback((estadoAnterior, estadoNuevo) => {
    setResumen((actual) => actualizarResumenPorCambioTarea(actual, estadoAnterior, estadoNuevo));
  }, []);

  return (
    <AlertasContext.Provider value={{ resumen, total, tareasPendientes: totalTareasActivas(resumen), refrescar, registrarCambioTarea }}>
      {children}
    </AlertasContext.Provider>
  );
}

export function useAlertas() {
  return useContext(AlertasContext);
}
