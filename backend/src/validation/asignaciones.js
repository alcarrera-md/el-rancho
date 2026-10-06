const { z, id, idOpcional, paramsId, texto, textoOpcional, fecha, cantidadPositivaOpcional } = require('./comun');

const tipo = z.enum([
  'revision_salud', 'alimentacion', 'pesaje', 'movimiento',
  'vacunacion_tratamiento', 'revision_general', 'otra',
], { error: 'Selecciona un tipo de actividad válido.' });
const prioridad = z.enum(['baja', 'media', 'alta', 'urgente'], { error: 'Selecciona una prioridad válida.' });
const estado = z.enum(['pendiente', 'en_progreso', 'completada', 'cancelada'], { error: 'Selecciona un estado válido.' });

const idNullable = z.preprocess(
  (value) => (value === '' ? null : value),
  z.union([id, z.null()]).optional()
);
const cantidadNullable = z.preprocess(
  (value) => {
    if (value === '' || value === null) return null;
    if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
    return value;
  },
  z.number().finite().positive('Debe ser mayor que cero.').nullable().optional()
);
const idsCorrales = z.array(id).max(50, 'Selecciona como máximo 50 corrales.')
  .transform((valores) => [...new Set(valores)]);

const crear = z.strictObject({
  titulo: texto(150),
  descripcion: texto(2000),
  tipo,
  trabajador_id: id,
  corral_id: idOpcional,
  corral_ids: idsCorrales.optional(),
  animal_id: idOpcional,
  insumo_id: idOpcional,
  cantidad: cantidadPositivaOpcional,
  fecha_limite: fecha,
  prioridad,
});

const editar = z.strictObject({
  titulo: texto(150).optional(),
  descripcion: textoOpcional(2000),
  tipo: tipo.optional(),
  trabajador_id: id.optional(),
  corral_id: idNullable,
  corral_ids: idsCorrales.optional(),
  animal_id: idNullable,
  insumo_id: idNullable,
  cantidad: cantidadNullable,
  fecha_limite: fecha.optional(),
  prioridad: prioridad.optional(),
  estado: estado.optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Envía al menos un campo para modificar.' });

const completar = z.strictObject({
  completada: z.boolean({ error: 'Debe indicar si la tarea está completada.' }),
  expected_version: id.optional(),
});

const query = z.strictObject({
  trabajador_id: idOpcional,
  corral_id: idOpcional,
  animal_id: idOpcional,
  tipo: tipo.optional(),
  prioridad: prioridad.optional(),
  estado: estado.optional(),
  completada: z.enum(['true', 'false']).optional(),
});

module.exports = { crear, editar, completar, query, paramsId };
