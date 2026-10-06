import { tienePermiso } from './authorization/permissions.js';

export const ACCIONES_CAMPO = Object.freeze({
  ABRIR: 'abrir',
  PESAJE: 'pesaje',
  ALIMENTACION: 'alimentacion',
  OBSERVACION: 'observacion',
  SALUD: 'salud',
  MOVER: 'mover',
  LECHE: 'leche',
  NOTA: 'nota',
  CONDICION: 'condicion',
});

const DEFINICIONES = Object.freeze([
  { id: ACCIONES_CAMPO.PESAJE, label: 'Pesaje', permiso: ['pesajes', 'crear'] },
  { id: ACCIONES_CAMPO.ALIMENTACION, label: 'Alimentar', permiso: ['alimentacion', 'crear'] },
  { id: ACCIONES_CAMPO.OBSERVACION, label: 'Requiere revisión', permiso: ['animales', 'reportar_observacion'] },
  { id: ACCIONES_CAMPO.SALUD, label: 'Salud', permiso: ['salud', 'crear'] },
  { id: ACCIONES_CAMPO.MOVER, label: 'Mover de corral', permiso: ['animales', 'editar'] },
  { id: ACCIONES_CAMPO.LECHE, label: 'Registrar leche', permiso: ['produccion_leche', 'crear'], soloHembra: true },
  { id: ACCIONES_CAMPO.NOTA, label: 'Agregar nota', permiso: ['notas_seguimiento', 'crear'] },
  { id: ACCIONES_CAMPO.CONDICION, label: 'Condición corporal', permiso: ['condicion_corporal', 'crear'] },
]);

export function accionesCampoDisponibles(rol, animal, { incluirAbrir = false } = {}) {
  const acciones = incluirAbrir ? [{ id: ACCIONES_CAMPO.ABRIR, label: 'Abrir ficha' }] : [];
  if (!animal || animal.estado !== 'vivo') return acciones;
  return acciones.concat(DEFINICIONES.filter((accion) => {
    if (accion.soloHembra && animal.sexo !== 'hembra') return false;
    return tienePermiso(rol, accion.permiso[0], accion.permiso[1]);
  }).map(({ id, label }) => ({ id, label })));
}

export function fechaLocalISO(fecha = new Date()) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

export function crearGuardiaEnvio() {
  let enviando = false;
  return {
    async ejecutar(tarea) {
      if (enviando) return { ejecutado: false };
      enviando = true;
      try {
        return { ejecutado: true, valor: await tarea() };
      } finally {
        enviando = false;
      }
    },
    enCurso() { return enviando; },
  };
}

export const MENSAJES_ACCION = Object.freeze({
  [ACCIONES_CAMPO.PESAJE]: 'Pesaje guardado correctamente.',
  [ACCIONES_CAMPO.ALIMENTACION]: 'Alimentación registrada correctamente.',
  [ACCIONES_CAMPO.OBSERVACION]: 'El animal quedó marcado para revisión.',
  [ACCIONES_CAMPO.SALUD]: 'Evento de salud guardado correctamente.',
  [ACCIONES_CAMPO.MOVER]: 'Animal movido de corral correctamente.',
  [ACCIONES_CAMPO.LECHE]: 'Producción de leche registrada correctamente.',
  [ACCIONES_CAMPO.NOTA]: 'Nota agregada al seguimiento.',
  [ACCIONES_CAMPO.CONDICION]: 'Condición corporal guardada correctamente.',
});
