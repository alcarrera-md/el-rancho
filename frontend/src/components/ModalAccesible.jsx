import { useEffect, useId, useRef } from 'react';
import { SELECTOR_FOCABLE, debeConfirmarCierre, indiceFocoAtrapado } from '../accessibility.js';

export default function ModalAccesible({
  titulo, onCerrar, children, className = '', sucio = false, ocupado = false,
  mensajeCierre = 'Hay cambios sin guardar. ¿Deseas cerrar y perderlos?', descripcionId,
}) {
  const tituloGenerado = useId();
  const dialogoRef = useRef(null);
  const focoAnterior = useRef(null);
  const cierreActual = useRef({ onCerrar, sucio, ocupado, mensajeCierre });
  cierreActual.current = { onCerrar, sucio, ocupado, mensajeCierre };

  function intentarCerrar() {
    const cierre = cierreActual.current;
    if (cierre.ocupado) return;
    if (debeConfirmarCierre(cierre) && !window.confirm(cierre.mensajeCierre)) return;
    cierre.onCerrar();
  }

  useEffect(() => {
    focoAnterior.current = document.activeElement;
    const dialogo = dialogoRef.current;
    const inicial = dialogo?.querySelector('[data-autofocus], [autofocus]')
      || dialogo?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    (inicial || dialogo)?.focus();

    function manejarTecla(evento) {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        intentarCerrar();
        return;
      }
      if (evento.key !== 'Tab') return;
      const focables = [...(dialogo?.querySelectorAll(SELECTOR_FOCABLE) || [])];
      if (focables.length === 0) { evento.preventDefault(); dialogo?.focus(); return; }
      const indice = focables.indexOf(document.activeElement);
      const salePorInicio = evento.shiftKey && indice <= 0;
      const salePorFinal = !evento.shiftKey && (indice === -1 || indice >= focables.length - 1);
      if (salePorInicio || salePorFinal) {
        evento.preventDefault();
        focables[indiceFocoAtrapado(indice, focables.length, evento.shiftKey)].focus();
      }
    }

    document.addEventListener('keydown', manejarTecla);
    return () => {
      document.removeEventListener('keydown', manejarTecla);
      focoAnterior.current?.focus?.();
    };
  }, []); // El listener consulta las props del montaje actual del modal.

  return (
    <div className="modal-backdrop" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) intentarCerrar(); }}>
      <div
        ref={dialogoRef}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloGenerado}
        aria-describedby={descripcionId}
        tabIndex={-1}
        onClickCapture={(evento) => {
          if (!evento.target.closest('[data-modal-cerrar]')) return;
          evento.preventDefault();
          evento.stopPropagation();
          intentarCerrar();
        }}
      >
        <h3 id={tituloGenerado}>{titulo}</h3>
        {children}
      </div>
    </div>
  );
}
