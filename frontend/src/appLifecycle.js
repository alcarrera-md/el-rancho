export const EVENTO_FORMULARIOS_SUCIOS = 'app:formularios-sucios';

let proteccionesActivas = 0;

function anunciar() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_FORMULARIOS_SUCIOS, { detail: { activos: proteccionesActivas } }));
  }
}
export function registrarFormularioSucio() {
  proteccionesActivas += 1;
  anunciar();
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    proteccionesActivas = Math.max(0, proteccionesActivas - 1);
    anunciar();
  };
}

export function hayFormularioSucio() {
  return proteccionesActivas > 0;
}
