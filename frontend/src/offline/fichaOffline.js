// P8.2 — modelo de lectura de la ficha y los corrales sin conexión.
// Combina el último snapshot del servidor con los cambios locales que el
// servidor aún no confirmó, SIN mezclarlos: el dato del servidor se muestra
// como tal y el cambio local aparece aparte, marcado como pendiente.
import { formatearFechaNegocio } from './formatoTiempo.js';

const ESTADO_VIDA = Object.freeze({
  vivo: 'Activo',
  vendido: 'Vendido',
  muerto: 'Muerto',
  sacrificado: 'Sacrificado',
});

const ESTADO_LOCAL = Object.freeze({
  pendiente: 'pendiente de sincronizar',
  sincronizando: 'sincronizando',
  bloqueada: 'en espera de revisión',
  error: 'necesita reintento',
});

const dos = (valor) => String(valor).padStart(2, '0');
function fechaLocalISO(fecha = new Date()) {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

// Solo la parte de fecha: "2026-06-19T06:00:00.000Z" (DATE serializado por
// el servidor en v3) y "2026-06-19" se leen igual, sin corrimiento de zona.
function soloFecha(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fechaLocalISO(fecha);
}

export function edadDesde(fechaNacimiento, hoy = new Date()) {
  const nacimiento = soloFecha(fechaNacimiento);
  if (!nacimiento) return null;
  const [anio, mes, dia] = nacimiento.split('-').map(Number);
  let meses = (hoy.getFullYear() - anio) * 12 + (hoy.getMonth() + 1 - mes);
  if (hoy.getDate() < dia) meses -= 1;
  if (meses < 1) return 'Recién nacido';
  if (meses < 24) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const anios = Math.floor(meses / 12);
  return `${anios} ${anios === 1 ? 'año' : 'años'}`;
}

export function numeroONull(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/** Corral tal como lo describe el snapshot; nunca inventa capacidad. */
export function resumenCorralOffline(corral) {
  if (!corral) return null;
  const capacidad = numeroONull(corral.capacidad_maxima);
  const ocupacion = numeroONull(corral.ocupacion_actual) ?? 0;
  const conCapacidad = capacidad !== null && capacidad > 0;
  return {
    id: corral.id,
    nombre: corral.nombre,
    capacidad: conCapacidad ? capacidad : null,
    ocupacion,
    disponible: conCapacidad ? Math.max(0, capacidad - ocupacion) : null,
    porcentaje: conCapacidad ? Math.min(100, Math.round((ocupacion / capacidad) * 100)) : null,
    texto_capacidad: conCapacidad ? `${ocupacion} de ${capacidad} lugares ocupados` : `${ocupacion} animales · capacidad no registrada`,
    texto_disponible: conCapacidad ? `${Math.max(0, capacidad - ocupacion)} disponibles` : 'Disponibilidad no calculable',
  };
}

function sinAcentos(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Búsqueda offline por arete o nombre (sin distinguir acentos) con filtros de estado y corral. */
export function buscarAnimalesOffline(animales, { q = '', estado = '', corralId = null } = {}) {
  const buscado = sinAcentos(q);
  return (animales || []).filter((animal) => {
    if (estado && animal.estado !== estado) return false;
    if (corralId && String(animal.corral_actual_id) !== String(corralId)) return false;
    if (buscado && !sinAcentos(`${animal.arete_id} ${animal.nombre_alias || ''}`).includes(buscado)) return false;
    return true;
  });
}

/** Animales activos de un corral según el snapshot (las bajas recientes no ocupan lugar). */
export function animalesDeCorralOffline(animales, corralId) {
  return (animales || []).filter((animal) => (!animal.estado || animal.estado === 'vivo') && String(animal.corral_actual_id) === String(corralId));
}

function describirOperacionLocal(operacion, nombresCorral) {
  const estado = ESTADO_LOCAL[operacion.estado] || 'pendiente de sincronizar';
  const payload = operacion.payload || {};
  switch (operacion.tipo) {
    case 'pesaje.crear':
      return { tipo: 'pesaje', texto: `Pesaje de ${payload.peso_kg} kg${payload.fecha ? ` (${formatearFechaNegocio(payload.fecha)})` : ''}`, estado };
    case 'nota_seguimiento.crear':
      return { tipo: 'nota', texto: `Nota: ${String(payload.contenido || '').slice(0, 80)}`, estado };
    case 'animal.reportar_observacion':
      return { tipo: 'observacion', texto: 'Reporte de revisión (observación)', estado };
    case 'animal.trasladar':
      return { tipo: 'movimiento', texto: `Movimiento a ${nombresCorral.get(String(payload.corral_id)) || 'otro corral'}`, estado };
    case 'alimentacion.crear':
      return { tipo: 'alimentacion', texto: `Alimentación de ${payload.cantidad} ${payload.unidad_medida || ''}`.trim(), estado };
    case 'evento_salud.crear':
      return { tipo: 'salud', texto: `Evento sanitario: ${[payload.tipo, payload.enfermedad].filter(Boolean).join(' · ')}${payload.fecha ? ` (${formatearFechaNegocio(payload.fecha)})` : ''}${payload.proxima_dosis ? ` · próxima ${formatearFechaNegocio(payload.proxima_dosis)}` : ''}`, estado };
    case 'condicion_corporal.crear':
      return { tipo: 'condicion', texto: `Condición corporal ${payload.puntuacion}/5${payload.fecha ? ` (${formatearFechaNegocio(payload.fecha)})` : ''}`, estado };
    default:
      return { tipo: 'otro', texto: 'Cambio de campo', estado };
  }
}

const ESTADOS_SIN_CONFIRMAR = new Set(['pendiente', 'sincronizando', 'bloqueada', 'error']);

/**
 * Consumo de alimento capturado en este dispositivo y aún no confirmado, por
 * insumo. Solo se informa: el stock del snapshot NO se descuenta, porque el
 * servidor decide al sincronizar si todavía alcanza (decisión D1).
 */
export function alimentacionPendientePorInsumo(operaciones) {
  const porInsumo = new Map();
  for (const operacion of operaciones || []) {
    if (operacion.tipo !== 'alimentacion.crear' || !ESTADOS_SIN_CONFIRMAR.has(operacion.estado)) continue;
    const insumoId = String(operacion.payload?.insumo_id ?? '');
    const cantidad = numeroONull(operacion.payload?.cantidad);
    if (!insumoId || cantidad === null) continue;
    const actual = porInsumo.get(insumoId) || { cantidad: 0, capturas: 0, unidad: operacion.payload?.unidad_medida || '' };
    actual.cantidad = Math.round((actual.cantidad + cantidad) * 1000) / 1000;
    actual.capturas += 1;
    porInsumo.set(insumoId, actual);
  }
  return porInsumo;
}

/** "Stock según última sincronización: 120 kg · 20 kg pendientes de sincronización". */
export function textoStockOffline(insumo, pendiente) {
  if (!insumo) return null;
  const base = `Stock según última sincronización: ${numeroONull(insumo.stock_actual) ?? insumo.stock_actual} ${insumo.unidad_medida || ''}`.trimEnd();
  return pendiente?.cantidad ? `${base} · ${pendiente.cantidad} ${pendiente.unidad || insumo.unidad_medida || ''} pendientes de sincronización`.trimEnd() : base;
}

/**
 * Modelo de la ficha offline. `cambios` viene de listarCambiosLocalesAnimal;
 * el snapshot (`animal`) nunca se modifica.
 */
export function construirFichaOffline({ animal, corrales = [], cambios = {}, hoy = new Date() }) {
  if (!animal) return null;
  const operaciones = cambios.operaciones || [];
  const conflictos = cambios.conflictos || [];
  const nombresCorral = new Map((corrales || []).map((corral) => [String(corral.id), corral.nombre]));
  const corral = (corrales || []).find((item) => String(item.id) === String(animal.corral_actual_id));
  const hoyISO = fechaLocalISO(hoy);
  const activo = !animal.estado || animal.estado === 'vivo';

  // Último pesaje local aún no confirmado: se muestra junto al del servidor.
  const pesajesLocales = operaciones
    .filter((operacion) => operacion.tipo === 'pesaje.crear' && numeroONull(operacion.payload?.peso_kg) !== null)
    .sort((a, b) => String(a.payload?.fecha || a.fecha_local).localeCompare(String(b.payload?.fecha || b.fecha_local)));
  const pesajeLocal = pesajesLocales.at(-1) || null;
  const condicionLocal = operaciones
    .filter((operacion) => operacion.tipo === 'condicion_corporal.crear' && numeroONull(operacion.payload?.puntuacion) !== null)
    .sort((a, b) => String(a.payload?.fecha || a.fecha_local).localeCompare(String(b.payload?.fecha || b.fecha_local)))
    .at(-1) || null;

  return {
    id: animal.id,
    titulo: animal.nombre_alias || `Animal ${animal.arete_id}`,
    identidad: {
      arete: animal.arete_id,
      nombre: animal.nombre_alias || null,
      sexo: animal.sexo === 'hembra' ? 'Hembra' : animal.sexo === 'macho' ? 'Macho' : null,
      categoria: animal.categoria || null,
      raza: animal.raza || null,
      nacimiento: formatearFechaNegocio(soloFecha(animal.fecha_nacimiento)),
      edad: edadDesde(animal.fecha_nacimiento, hoy),
    },
    vida: {
      activo,
      estado: ESTADO_VIDA[animal.estado] || 'Sin dato',
      fecha_baja: formatearFechaNegocio(animal.fecha_baja),
      aviso: activo ? null : `Este animal aparece como ${String(ESTADO_VIDA[animal.estado] || 'dado de baja').toLowerCase()}${animal.fecha_baja ? ` desde el ${formatearFechaNegocio(animal.fecha_baja)}` : ''} en la última sincronización.`,
    },
    corral: corral ? resumenCorralOffline(corral) : (animal.corral_actual ? { nombre: animal.corral_actual, capacidad: null, texto_capacidad: 'Sin datos del corral en el dispositivo' } : null),
    peso: {
      servidor: numeroONull(animal.ultimo_peso_kg) !== null
        ? { kg: numeroONull(animal.ultimo_peso_kg), fecha: formatearFechaNegocio(animal.ultimo_peso_fecha) }
        : null,
      pendiente: pesajeLocal
        ? { kg: numeroONull(pesajeLocal.payload.peso_kg), fecha: formatearFechaNegocio(pesajeLocal.payload.fecha), estado: ESTADO_LOCAL[pesajeLocal.estado] || 'pendiente de sincronizar' }
        : null,
    },
    condicion_corporal: numeroONull(animal.condicion_corporal) !== null
      ? { puntuacion: numeroONull(animal.condicion_corporal), fecha: formatearFechaNegocio(animal.condicion_corporal_fecha) }
      : null,
    condicion_corporal_pendiente: condicionLocal
      ? { puntuacion: numeroONull(condicionLocal.payload.puntuacion), fecha: formatearFechaNegocio(condicionLocal.payload.fecha), estado: ESTADO_LOCAL[condicionLocal.estado] || 'pendiente de sincronizar' }
      : null,
    salud: {
      estado: animal.estado_salud || null,
      desde: formatearFechaNegocio(animal.salud_fecha_inicio),
      diagnostico: animal.salud_diagnostico || null,
      eventos: (animal.eventos_salud_recientes || []).map((evento) => ({ ...evento, fecha: formatearFechaNegocio(evento.fecha) })),
      proximas_dosis: (animal.proximas_dosis || []).map((dosis) => ({
        ...dosis,
        vencida: soloFecha(dosis.fecha) < hoyISO,
        fecha: formatearFechaNegocio(dosis.fecha),
      })),
    },
    notas: (animal.notas_recientes || []).map((nota) => ({ ...nota, fecha: formatearFechaNegocio(nota.fecha) })),
    cambios_locales: operaciones.map((operacion) => ({ id: operacion.id, ...describirOperacionLocal(operacion, nombresCorral) })),
    conflictos: conflictos.length,
    // v3 no traía estos campos: la UI dice "sin dato en esta copia" en lugar de "ninguno".
    snapshot_completo: Object.hasOwn(animal, 'notas_recientes'),
  };
}
