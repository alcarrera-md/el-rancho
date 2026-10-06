export const SELECTOR_FOCABLE = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function debeConfirmarCierre({ sucio = false, ocupado = false } = {}) {
  return !ocupado && sucio;
}

export function indiceFocoAtrapado(indiceActual, total, retrocede = false) {
  if (total <= 0) return -1;
  if (retrocede && indiceActual <= 0) return total - 1;
  if (!retrocede && indiceActual >= total - 1) return 0;
  return indiceActual + (retrocede ? -1 : 1);
}

export function atributosAnuncio(tipo) {
  if (tipo === 'error') return { role: 'alert', 'aria-live': 'assertive' };
  return { role: 'status', 'aria-live': 'polite' };
}
