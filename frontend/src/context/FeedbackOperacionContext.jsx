import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { EVENTO_FEEDBACK_OPERACION, normalizarFeedbackOperacion } from '../feedbackOperacion.js';
import { IconoCheck } from '../components/Iconos.jsx';

const FeedbackOperacionContext = createContext(null);

function AvisoOperacion({ aviso, onCerrar }) {
  useEffect(() => {
    if (aviso.duracion <= 0) return undefined;
    const temporizador = window.setTimeout(() => onCerrar(aviso.id), aviso.duracion);
    return () => window.clearTimeout(temporizador);
  }, [aviso.id, aviso.duracion, onCerrar]);

  return (
    <div className={`feedback-global feedback-${aviso.tipo}`} role={aviso.tipo === 'error' ? 'alert' : 'status'} aria-live={aviso.tipo === 'error' ? 'assertive' : 'polite'}>
      <span className="feedback-global-icono" aria-hidden="true">{aviso.tipo === 'exito' ? <IconoCheck width={22} height={22} /> : '!'}</span>
      <span className="feedback-global-texto"><strong>{aviso.titulo}</strong>{aviso.mensaje && <span>{aviso.mensaje}</span>}</span>
      <button type="button" className="feedback-global-cerrar" onClick={() => onCerrar(aviso.id)} aria-label="Cerrar confirmación">×</button>
    </div>
  );
}

export function FeedbackOperacionProvider({ children }) {
  const [avisos, setAvisos] = useState([]);
  const cerrar = useCallback((id) => setAvisos((actuales) => actuales.filter((aviso) => aviso.id !== id)), []);
  const mostrar = useCallback((detalle, tipo = 'exito') => {
    const aviso = normalizarFeedbackOperacion(detalle, tipo);
    setAvisos((actuales) => [...actuales.slice(-2), aviso]);
    return aviso.id;
  }, []);

  useEffect(() => {
    const manejar = (evento) => mostrar(evento.detail, evento.detail?.tipo);
    window.addEventListener(EVENTO_FEEDBACK_OPERACION, manejar);
    return () => window.removeEventListener(EVENTO_FEEDBACK_OPERACION, manejar);
  }, [mostrar]);

  const valor = useMemo(() => ({
    mostrarExito: (detalle) => mostrar(detalle, 'exito'),
    mostrarError: (detalle) => mostrar(detalle, 'error'),
    cerrar,
  }), [mostrar, cerrar]);

  return (
    <FeedbackOperacionContext.Provider value={valor}>
      {children}
      <div className="feedback-global-bandeja" aria-label="Confirmaciones de operaciones">
        {avisos.map((aviso) => <AvisoOperacion key={aviso.id} aviso={aviso} onCerrar={cerrar} />)}
      </div>
    </FeedbackOperacionContext.Provider>
  );
}

export function useFeedbackOperacion() {
  const contexto = useContext(FeedbackOperacionContext);
  if (!contexto) throw new Error('useFeedbackOperacion debe usarse dentro de FeedbackOperacionProvider');
  return contexto;
}
