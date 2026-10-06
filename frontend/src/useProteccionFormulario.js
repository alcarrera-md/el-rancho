import { useEffect } from 'react';
import { registrarFormularioSucio } from './appLifecycle.js';

export function esEnlaceInternoDistinto(enlace, ubicacionActual = window.location.href) {
  if (!enlace?.href || enlace.target === '_blank' || enlace.hasAttribute?.('download')) return false;
  const destino = new URL(enlace.href, ubicacionActual);
  const actual = new URL(ubicacionActual);
  return destino.origin === actual.origin
    && `${destino.pathname}${destino.search}${destino.hash}` !== `${actual.pathname}${actual.search}${actual.hash}`;
}

export function useProteccionFormulario(activa, mensaje = 'Hay datos sin guardar. ¿Deseas salir y perderlos?') {
  useEffect(() => {
    if (!activa) return undefined;
    const liberarFormulario = registrarFormularioSucio();
    const advertir = (evento) => { evento.preventDefault(); evento.returnValue = ''; };
    const confirmarEnlace = (evento) => {
      if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      const enlace = evento.target?.closest?.('a[href]');
      if (!esEnlaceInternoDistinto(enlace) || window.confirm(mensaje)) return;
      evento.preventDefault();
      evento.stopPropagation();
    };
    window.addEventListener('beforeunload', advertir);
    document.addEventListener('click', confirmarEnlace, true);
    return () => {
      window.removeEventListener('beforeunload', advertir);
      document.removeEventListener('click', confirmarEnlace, true);
      liberarFormulario();
    };
  }, [activa, mensaje]);
}
