const { z, id, idOpcional, paramsId, textoOpcional, fecha, fechaOpcional } = require('./comun');

const categorias = [
  'semen', 'inseminacion', 'monta_servicio', 'palpacion', 'ultrasonido',
  'veterinario', 'medicamento_insumo', 'procedimiento', 'transporte', 'otro',
];
const procedencias = ['captura_manual', 'compra_insumo_relacionada', 'gasto_general_relacionado', 'importacion', 'migracion'];
const monto = z.union([z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/, 'Usa un importe positivo con máximo dos decimales.').refine((valor) => Number(valor) > 0, 'El monto debe ser mayor que cero.'), z.number().positive().finite()])
  .transform((valor) => String(valor));

const relaciones = {
  ciclo_id: idOpcional, servicio_id: idOpcional, diagnostico_id: idOpcional, parto_id: idOpcional,
  animal_id: idOpcional, toro_id: idOpcional, responsable_id: idOpcional, proveedor_id: idOpcional,
  insumo_id: idOpcional, compra_insumo_id: idOpcional, gasto_general_id: idOpcional,
};

function validarFuente(data, ctx) {
  const contexto = ['ciclo_id', 'servicio_id', 'diagnostico_id', 'parto_id', 'animal_id', 'toro_id'];
  if (!contexto.some((clave) => data[clave])) ctx.addIssue({ code: 'custom', path: ['ciclo_id'], message: 'Relaciona el costo con al menos un ciclo, evento o animal.' });
  if (data.procedencia === 'compra_insumo_relacionada' && !data.compra_insumo_id) ctx.addIssue({ code: 'custom', path: ['compra_insumo_id'], message: 'Selecciona la compra de insumo de origen.' });
  if (data.procedencia === 'gasto_general_relacionado' && !data.gasto_general_id) ctx.addIssue({ code: 'custom', path: ['gasto_general_id'], message: 'Selecciona el gasto general de origen.' });
  if (data.procedencia !== 'compra_insumo_relacionada' && data.compra_insumo_id) ctx.addIssue({ code: 'custom', path: ['procedencia'], message: 'La compra solo aplica a su procedencia correspondiente.' });
  if (data.procedencia !== 'gasto_general_relacionado' && data.gasto_general_id) ctx.addIssue({ code: 'custom', path: ['procedencia'], message: 'El gasto general solo aplica a su procedencia correspondiente.' });
}

const crear = z.strictObject({
  fecha,
  categoria: z.enum(categorias),
  monto,
  procedencia: z.enum(procedencias).default('captura_manual'),
  ...relaciones,
  descripcion: textoOpcional(500),
}).superRefine(validarFuente);

const editar = z.strictObject({
  fecha: fechaOpcional(fecha), categoria: z.enum(categorias).optional(), monto: monto.optional(),
  procedencia: z.enum(procedencias).optional(), ...relaciones, descripcion: textoOpcional(500),
});

const queryLista = z.strictObject({
  desde: fechaOpcional(fecha), hasta: fechaOpcional(fecha), categoria: z.enum(categorias).optional(),
  ciclo_id: idOpcional, animal_id: idOpcional, toro_id: idOpcional,
}).superRefine((data, ctx) => {
  if (data.desde && data.hasta && data.desde > data.hasta) ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Debe ser igual o posterior a la fecha inicial.' });
});

const queryAnalitica = z.strictObject({
  periodo: z.enum(['mes_actual', 'anio_actual', 'ultimos_30_dias', 'personalizado']).default('anio_actual'),
  desde: fechaOpcional(fecha), hasta: fechaOpcional(fecha), animal_id: idOpcional, toro_id: idOpcional,
}).superRefine((data, ctx) => {
  if (data.periodo === 'personalizado' && (!data.desde || !data.hasta)) ctx.addIssue({ code: 'custom', path: ['desde'], message: 'El rango personalizado requiere ambas fechas.' });
  if (data.desde && data.hasta && data.desde > data.hasta) ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Debe ser igual o posterior a la fecha inicial.' });
});

module.exports = { categorias, crear, editar, paramsId, queryLista, queryAnalitica };
