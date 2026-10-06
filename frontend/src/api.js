import { reportarFalloDeConectividad } from './offline/connectivity.js';

const ORIGIN = '';
const BASE_URL = '/api';
const TOKEN_KEY = 'sistema_ganadero_token';

export function urlFoto(foto_url) {
  if (!foto_url) return null;
  return `${ORIGIN}${foto_url}`;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function crearErrorApi(errorApi, status, { ruta = null, metodo = 'GET' } = {}) {
  const mensaje =
    typeof errorApi === 'string'
      ? errorApi
      : errorApi?.message || `Error ${status}`;

  const error = new Error(mensaje);
  error.status = status;
  error.ruta = ruta;
  error.metodo = metodo;

  if (errorApi && typeof errorApi === 'object') {
    error.code = errorApi.code;
    error.details = errorApi.details;
  }

  return error;
}

async function request(path, options = {}) {
  const esFormData = options.body instanceof FormData;
  const token = getToken();
  const metodo = options.method || 'GET';
  const ruta = `${BASE_URL}${path}`;

  const headers = {
    ...(esFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  // timeoutMs: un servidor inalcanzable (p. ej. el celular salió del hotspot
  // de la laptop pero tiene otra red) no debe dejar la app colgada esperando
  // el timeout TCP del sistema; se trata igual que un fallo de conexión.
  const { timeoutMs, ...opcionesFetch } = options;
  const controlador = timeoutMs ? new AbortController() : null;
  const temporizador = controlador ? setTimeout(() => controlador.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(ruta, {
      ...opcionesFetch,
      headers,
      cache: 'no-store',
      ...(controlador ? { signal: controlador.signal } : {}),
    });
  } catch (causa) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const error = new Error(offline
      ? 'Sin conexión. Esta información necesita Internet.'
      : 'No se pudo conectar con el servidor.');
    error.code = offline ? 'OFFLINE' : 'NETWORK_ERROR';
    error.cause = causa;
    error.ruta = ruta;
    error.metodo = metodo;
    reportarFalloDeConectividad();
    throw error;
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }

  const data = await res.json().catch(() => null);

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  }

  if (!res.ok) {
    const errorApi = data && data.error;
    throw crearErrorApi(errorApi, res.status, { ruta, metodo });
  }

  return data;
}

function headersIdempotencia(metadata) {
  if (!metadata?.id) return {};
  return {
    'Idempotency-Key': metadata.id,
    'X-Offline-Operation': metadata.offline ? 'true' : 'false',
    ...(metadata.installationId ? { 'X-Client-Installation-Id': metadata.installationId } : {}),
    ...(metadata.fechaLocal ? { 'X-Client-Local-Timestamp': metadata.fechaLocal } : {}),
  };
}

export const api = {
  listarAnimales: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/animales${qs ? `?${qs}` : ''}`);
  },

  obtenerHistorial: (id) =>
    request(`/animales/${id}/historial`),

  crearAnimal: (payload) =>
    request('/animales', {
      method: 'POST',
      body: payload,
    }),

  trasladarAnimal: (id, datos, metadata = null) =>
    request(`/animales/${id}/corral`, {
      method: 'PATCH',
      body: JSON.stringify(typeof datos === 'object' ? datos : { corral_id: datos }),
      headers: headersIdempotencia(metadata),
    }),

  darDeBaja: (id, payload) =>
    request(`/animales/${id}/baja`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  actualizarAnimal: (id, formData) =>
    request(`/animales/${id}`, {
      method: 'PATCH',
      body: formData,
    }),

  importarAnimales: (animales) =>
    request('/animales/importar', {
      method: 'POST',
      body: JSON.stringify({ animales }),
    }),

  cambiarEstadoSalud: (id, payload, metadata = null) =>
    request(`/animales/${id}/estado-salud`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: headersIdempotencia(metadata),
    }),

  cambiarCategoria: (id, payload) =>
    request(`/animales/${id}/categoria`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listarCondicion: (animalId) =>
    request(`/condicion-corporal/animal/${animalId}`),

  registrarCondicion: (payload, metadata = null) =>
    request('/condicion-corporal', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: headersIdempotencia(metadata),
    }),

  actualizarCondicion: (id, payload) =>
    request(`/condicion-corporal/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  eliminarCondicion: (id) =>
    request(`/condicion-corporal/${id}`, {
      method: 'DELETE',
    }),

  listarNotas: (animalId) =>
    request(`/notas-seguimiento/animal/${animalId}`),

  crearNota: (payload, metadata = null) =>
    request('/notas-seguimiento', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: headersIdempotencia(metadata),
    }),

  eliminarNota: (id) =>
    request(`/notas-seguimiento/${id}`, {
      method: 'DELETE',
    }),

  obtenerConfiguracion: () =>
    request('/configuracion'),

  actualizarConfiguracion: (cambios) =>
    request('/configuracion', {
      method: 'PATCH',
      body: JSON.stringify(cambios),
    }),

  listarPlanesSanitarios: () =>
    request('/planes-sanitarios'),

  obtenerPlanSanitario: (id) =>
    request(`/planes-sanitarios/${id}`),

  crearPlanSanitario: (payload) =>
    request('/planes-sanitarios', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editarPlanSanitario: (id, payload) =>
    request(`/planes-sanitarios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  eliminarPlanSanitario: (id) =>
    request(`/planes-sanitarios/${id}`, {
      method: 'DELETE',
    }),

  agregarItemPlan: (planId, payload) =>
    request(`/planes-sanitarios/${planId}/items`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editarItemPlan: (itemId, payload) =>
    request(`/planes-sanitarios/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  eliminarItemPlan: (itemId) =>
    request(`/planes-sanitarios/items/${itemId}`, {
      method: 'DELETE',
    }),

  asignarPlanSanitario: (planId, animal_ids) =>
    request(`/planes-sanitarios/${planId}/asignar`, {
      method: 'POST',
      body: JSON.stringify({ animal_ids }),
    }),

  quitarAsignacionPlan: (asignacionId) =>
    request(`/planes-sanitarios/asignaciones/${asignacionId}`, {
      method: 'DELETE',
    }),

  pendientesPlanAnimal: (animalId) =>
    request(`/planes-sanitarios/animal/${animalId}/pendientes`),

  obtenerCalendario: (desde, hasta) =>
    request(`/calendario?desde=${desde}&hasta=${hasta}`),

  obtenerGenealogia: (animalId) =>
    request(`/genealogia/${animalId}`),

  verificarConsanguinidad: (madreId, padreId) =>
    request(
      `/genealogia/consanguinidad/verificar?madre_id=${madreId}&padre_id=${padreId}`
    ),

  listarLeche: (animalId) =>
    request(`/leche/animal/${animalId}`),

  resumenLeche: (animalId) =>
    request(`/leche/animal/${animalId}/resumen`),

  registrarLeche: (payload) =>
    request('/leche', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  actualizarLeche: (id, payload) =>
    request(`/leche/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  eliminarLeche: (id) =>
    request(`/leche/${id}`, {
      method: 'DELETE',
    }),

  listarCorrales: () =>
    request('/corrales'),

  listarMovimientos: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/corrales/movimientos${qs ? `?${qs}` : ''}`);
  },

  crearCorral: (payload) =>
    request('/corrales', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editarCorral: (id, payload) =>
    request(`/corrales/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  registrarPesaje: (payload, metadata = null) =>
    request('/pesajes', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: headersIdempotencia(metadata),
    }),

  registrarPesajesLote: (payload) =>
    request('/pesajes/lote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  pesajesActual: () =>
    request('/pesajes/actual'),

  pesajesEvolucion: () =>
    request('/pesajes/evolucion'),

  compararPesajes: (animalIds) =>
    request(`/pesajes/comparar?animal_ids=${animalIds.join(',')}`),

  actualizarPesaje: (id, payload) =>
    request(`/pesajes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  eliminarPesaje: (id) =>
    request(`/pesajes/${id}`, {
      method: 'DELETE',
    }),

  registrarSalud: (payload, metadata = null) =>
    request('/salud', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: headersIdempotencia(metadata),
    }),

  registrarSaludLote: (payload) =>
    request('/salud/lote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  actualizarSalud: (id, payload) =>
    request(`/salud/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  eliminarSalud: (id) =>
    request(`/salud/${id}`, {
      method: 'DELETE',
    }),

  proximasVacunas: (dias = 30, incluirVencidas = false) =>
    request(
      `/salud/proximas?dias=${dias}${
        incluirVencidas ? '&incluirVencidas=true' : ''
      }`
    ),

  listarSalud: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/salud${qs ? `?${qs}` : ''}`);
  },

  registrarAlimentacion: (payload, metadata = null) =>
    request('/alimentacion', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: headersIdempotencia(metadata),
    }),

  registrarAlimentacionLote: (payload) =>
    request('/alimentacion/lote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  actualizarAlimentacion: (id, payload) =>
    request(`/alimentacion/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  eliminarAlimentacion: (id) =>
    request(`/alimentacion/${id}`, {
      method: 'DELETE',
    }),

  stockBajo: () =>
    request('/alimentacion/stock-bajo'),

  listarAlimentacion: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/alimentacion${qs ? `?${qs}` : ''}`);
  },

  listarInsumos: (tipo) =>
    request(`/insumos${tipo ? `?tipo=${tipo}` : ''}`),

  crearInsumo: (payload) =>
    request('/insumos', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editarInsumo: (id, payload) =>
    request(`/insumos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  registrarMonta: (payload) =>
    request('/reproduccion', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  registrarServicioReproductivo: (payload) =>
    request('/reproduccion/servicios', { method: 'POST', body: JSON.stringify(payload) }),

  listarResponsablesReproduccion: () => request('/reproduccion/responsables'),

  obtenerHatoReproductivoOperable: () => request('/reproduccion/hato-operable'),

  obtenerAnaliticaReproductiva: (params = {}) =>
    request(`/reproduccion/analitica/resumen?${new URLSearchParams(Object.entries(params).filter(([, valor]) => valor !== '' && valor != null)).toString()}`),

  obtenerDetalleMetricaReproductiva: (metrica, params = {}) =>
    request(`/reproduccion/analitica/drill-down?${new URLSearchParams(Object.entries({ ...params, metrica }).filter(([, valor]) => valor !== '' && valor != null)).toString()}`),

  listarSementalesReproductivos: (params = {}) =>
    request(`/reproduccion/analitica/sementales?${new URLSearchParams(Object.entries(params).filter(([, valor]) => valor !== '' && valor != null)).toString()}`),

  obtenerPerfilSemental: (id, params = {}) =>
    request(`/reproduccion/analitica/sementales/${id}?${new URLSearchParams(Object.entries(params).filter(([, valor]) => valor !== '' && valor != null)).toString()}`),

  listarCostosReproductivos: (params = {}) =>
    request(`/costos-reproductivos?${new URLSearchParams(Object.entries(params).filter(([, valor]) => valor !== '' && valor != null)).toString()}`),

  crearCostoReproductivo: (payload) => request('/costos-reproductivos', { method: 'POST', body: JSON.stringify(payload) }),
  editarCostoReproductivo: (id, payload) => request(`/costos-reproductivos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  eliminarCostoReproductivo: (id) => request(`/costos-reproductivos/${id}`, { method: 'DELETE' }),
  obtenerAnaliticaCostosReproductivos: (params = {}) =>
    request(`/costos-reproductivos/analitica/resumen?${new URLSearchParams(Object.entries(params).filter(([, valor]) => valor !== '' && valor != null)).toString()}`),
  obtenerEconomiaSemental: (id, params = {}) =>
    request(`/costos-reproductivos/sementales/${id}?${new URLSearchParams(Object.entries(params).filter(([, valor]) => valor !== '' && valor != null)).toString()}`),

  validarLoteReproductivo: (payload) =>
    request('/reproduccion/lotes/validar', { method: 'POST', body: JSON.stringify(payload) }),

  confirmarLoteReproductivo: (payload) =>
    request('/reproduccion/lotes/confirmar', { method: 'POST', body: JSON.stringify(payload) }),

  exportarReproduccion: (params = {}) =>
    request(`/reproduccion/exportacion?${new URLSearchParams(Object.entries(params).filter(([, valor]) => valor !== '' && valor != null)).toString()}`),

  obtenerCicloReproductivoActual: (animalId) =>
    request(`/reproduccion/animales/${animalId}/ciclo-actual`),

  obtenerHistorialReproductivo: (animalId) =>
    request(`/reproduccion/animales/${animalId}/historial`),

  registrarDiagnosticoGestacion: (cicloId, payload) =>
    request(`/reproduccion/ciclos/${cicloId}/diagnosticos`, {
      method: 'POST', body: JSON.stringify(payload),
    }),

  registrarPartoV2: (cicloId, payload) =>
    request(`/reproduccion/ciclos/${cicloId}/partos`, {
      method: 'POST', body: JSON.stringify(payload),
    }),

  pendientesDiagnostico: () => request('/reproduccion/pendientes-diagnostico'),

  registrarParto: (id, payload) =>
    request(`/reproduccion/${id}/parto`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  partosProximos: (dias = 30, incluirVencidos = false) =>
    request(
      `/reproduccion/partos-proximos?dias=${dias}${
        incluirVencidos ? '&incluirVencidos=true' : ''
      }`
    ),

  listarReproduccion: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reproduccion${qs ? `?${qs}` : ''}`);
  },

  listarGestantes: () =>
    request('/reproduccion/gestantes'),

  registrarVenta: (payload) =>
    request('/ventas', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  registrarVentaLote: (payload) =>
    request('/ventas/lote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listarVentasLote: () =>
    request('/ventas/lotes'),

  reporteVentas: (params = {}) =>
    request(`/ventas/reporte?${new URLSearchParams(params).toString()}`),

  listarTerceros: (tipo) =>
    request(`/terceros${tipo ? `?tipo=${tipo}` : ''}`),

  crearTercero: (payload) =>
    request('/terceros', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editarTercero: (id, payload) =>
    request(`/terceros/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  reporteResumen: () =>
    request('/reportes/resumen'),

  reporteRentabilidad: (estado) =>
    request(`/reportes/rentabilidad${estado ? `?estado=${estado}` : ''}`),

  reporteFinanciero: (params = {}) =>
    request(`/reportes/financiero?${new URLSearchParams(params).toString()}`),

  obtenerClima: () =>
    request('/clima/pronostico'),

  listarModulos: () =>
    request('/modulos'),

  actualizarModulos: (cambios) =>
    request('/modulos', {
      method: 'PATCH',
      body: JSON.stringify(cambios),
    }),

  obtenerDestinatariosCorte: () =>
    request('/corte-diario-destinatarios'),

  agregarDestinatarioCorte: (email) =>
    request('/corte-diario-destinatarios', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  eliminarDestinatarioCorte: (id) =>
    request(`/corte-diario-destinatarios/${id}`, {
      method: 'DELETE',
    }),

  generarResumenIA: (animalId) =>
    request(`/asistente/resumen-animal/${animalId}`, {
      method: 'POST',
    }),

  consultarAsistente: (mensaje, historial, contexto = null) =>
    request('/asistente/chat', {
      method: 'POST',
      body: JSON.stringify({ mensaje, historial, ...(contexto ? { contexto } : {}) }),
    }),

  listarGastos: (params = {}) =>
    request(`/gastos-generales?${new URLSearchParams(params).toString()}`),

  crearGasto: (payload) =>
    request('/gastos-generales', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editarGasto: (id, payload) =>
    request(`/gastos-generales/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  eliminarGasto: (id) =>
    request(`/gastos-generales/${id}`, {
      method: 'DELETE',
    }),

  listarCategoriasGasto: () =>
    request('/gastos-generales/categorias'),

  crearCategoriaGasto: (nombre) =>
    request('/gastos-generales/categorias', {
      method: 'POST',
      body: JSON.stringify({ nombre }),
    }),

  listarTrabajadores: () =>
    request('/trabajadores'),

  crearTrabajador: (payload) =>
    request('/trabajadores', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editarTrabajador: (id, payload) =>
    request(`/trabajadores/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  cambiarEstadoTrabajador: (id, activo) =>
    request(`/trabajadores/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ activo }),
    }),

  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  // 6 s: al abrir la app sin llegar al servidor se entra al modo sin conexión
  // en lugar de esperar el timeout TCP del sistema.
  perfilActual: () =>
    request('/auth/me', { timeoutMs: 6000 }),

  bootstrapSync: () =>
    request('/sync/bootstrap'),

  cambiarPasswordPropio: (passwordActual, passwordNuevo) =>
    request('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify({ password_actual: passwordActual, password_nuevo: passwordNuevo }),
    }),

  listarUsuarios: () =>
    request('/usuarios'),

  listarRoles: () =>
    request('/usuarios/roles'),

  crearUsuario: (payload) =>
    request('/usuarios', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  actualizarUsuario: (id, payload) =>
    request(`/usuarios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  restablecerPassword: (id, password) =>
    request(`/usuarios/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    }),

  desbloquearUsuario: (id) =>
    request(`/usuarios/${id}/desbloquear`, {
      method: 'PATCH',
    }),

  listarBitacora: (params = {}) =>
    request(`/bitacora?${new URLSearchParams(params).toString()}`),

  usuariosBitacora: () =>
    request('/bitacora/usuarios'),

  cortesDiarios: (params = {}) =>
    request(`/bitacora/cortes-diarios?${new URLSearchParams(params).toString()}`),

  enviarCorteDiario: (fecha) =>
    request('/bitacora/corte-diario', {
      method: 'POST',
      body: JSON.stringify({ fecha }),
    }),

  listarTareas: (params = {}) =>
    request(`/asignaciones?${new URLSearchParams(params).toString()}`),

  obtenerTarea: (id) =>
    request(`/asignaciones/${id}`),

  crearTarea: (payload) =>
    request('/asignaciones', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  editarTarea: (id, payload) =>
    request(`/asignaciones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  completarTarea: (id, completada, expectedVersion = undefined, metadata = null) =>
    request(`/asignaciones/${id}/completar`, {
      method: 'PATCH',
      body: JSON.stringify({ completada, ...(expectedVersion === undefined ? {} : { expected_version: expectedVersion }) }),
      headers: headersIdempotencia(metadata),
    }),

  eliminarTarea: (id) =>
    request(`/asignaciones/${id}`, {
      method: 'DELETE',
    }),

  resumenAlertas: () =>
    request('/alertas/resumen'),

  alertasHato: () =>
    request('/alertas/hato'),

  analizarBroteIA: (animalId) =>
    request('/alertas/hato/analisis-ia', {
      method: 'POST',
      body: JSON.stringify({ animal_id: animalId }),
    }),

  listarRazas: () =>
    request('/razas'),

  crearRaza: (nombre) =>
    request('/razas', {
      method: 'POST',
      body: JSON.stringify({ nombre }),
    }),

  listarComprasInsumo: () =>
    request('/compras-insumo'),

  crearCompraInsumo: (payload) =>
    request('/compras-insumo', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listarComprasAnimal: (params = {}) =>
    request(`/compras-animal?${new URLSearchParams(params).toString()}`),

  crearCompraAnimal: (payload) =>
    request('/compras-animal', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  comprarAnimalNuevo: (payload) =>
    request('/compras-animal/nuevo', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
