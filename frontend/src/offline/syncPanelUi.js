export const ESTADO_PANEL_SYNC_INICIAL = Object.freeze({
  abierto: false,
  sincronizando: false,
});

export function reducirEstadoPanelSync(estado, accion) {
  switch (accion.type) {
    case 'abrir': return { ...estado, abierto: true };
    case 'cerrar': return { ...estado, abierto: false };
    case 'iniciar_sincronizacion': return { ...estado, sincronizando: true };
    case 'terminar_sincronizacion': return { ...estado, sincronizando: false };
    default: return estado;
  }
}

// El proceso pertenece a la página de configuración, no al modal. Cerrar o
// desmontar el panel visual no aborta la promesa que procesa la cola.
export async function ejecutarSincronizacionIndependiente(sincronizar, despachar) {
  despachar({ type: 'iniciar_sincronizacion' });
  try {
    return await sincronizar();
  } finally {
    despachar({ type: 'terminar_sincronizacion' });
  }
}
