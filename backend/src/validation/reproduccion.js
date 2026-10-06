const { z, id, idOpcional, paramsId, textoOpcional, fecha, fechaNoFutura, fechaOpcional, cantidadPositivaOpcional } = require('./comun');

const tipoServicio = z.enum(['natural', 'inseminacion_artificial', 'otro']);
const metodoDiagnostico = z.enum(['palpacion', 'ecografia', 'otro']);
const resultadoDiagnostico = z.enum(['prenada', 'vacia', 'dudoso']);
const costoDirecto = z.strictObject({
  categoria: z.enum(['semen','inseminacion','monta_servicio','palpacion','ultrasonido','veterinario','medicamento_insumo','procedimiento','transporte','otro']),
  monto: z.union([z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).refine((valor) => Number(valor) > 0, 'El monto debe ser mayor que cero.'), z.number().positive().finite()]).transform(String),
  descripcion: textoOpcional(500),
}).optional();

const servicio = z.strictObject({
  hembra_id: id,
  fecha: fechaNoFutura,
  tipo: tipoServicio,
  macho_id: idOpcional,
  tipo_otro: textoOpcional(120),
  responsable_id: idOpcional,
  observaciones: textoOpcional(2000),
  fecha_parto_estimada_ajustada: fechaOpcional(fecha),
  costo: costoDirecto,
}).superRefine((data, ctx) => {
  if (data.tipo === 'otro' && !data.tipo_otro) ctx.addIssue({ code: 'custom', path: ['tipo_otro'], message: 'Describe el otro tipo de servicio.' });
  if (data.tipo !== 'otro' && data.tipo_otro) ctx.addIssue({ code: 'custom', path: ['tipo_otro'], message: 'Solo aplica cuando el tipo es otro.' });
  if (data.fecha_parto_estimada_ajustada && data.fecha_parto_estimada_ajustada <= data.fecha) {
    ctx.addIssue({ code: 'custom', path: ['fecha_parto_estimada_ajustada'], message: 'Debe ser posterior al servicio.' });
  }
});

// Compatibilidad del formulario anterior; se transforma al contrato v2.
const servicioLegacy = z.strictObject({
  madre_id: id,
  padre_id: idOpcional,
  tipo_monta: z.enum(['natural', 'inseminacion_artificial']),
  fecha_monta: fechaNoFutura,
  fecha_parto_estimada: fechaOpcional(fecha),
}).transform((data) => ({
  hembra_id: data.madre_id,
  macho_id: data.padre_id,
  tipo: data.tipo_monta,
  fecha: data.fecha_monta,
  fecha_parto_estimada_ajustada: data.fecha_parto_estimada,
}));

const diagnostico = z.strictObject({
  servicio_id: idOpcional,
  fecha: fechaNoFutura,
  metodo: metodoDiagnostico,
  metodo_otro: textoOpcional(120),
  resultado: resultadoDiagnostico,
  responsable_id: idOpcional,
  observaciones: textoOpcional(2000),
  fecha_siguiente_revision: fechaOpcional(fecha),
  costo: costoDirecto,
}).superRefine((data, ctx) => {
  if (data.metodo === 'otro' && !data.metodo_otro) ctx.addIssue({ code: 'custom', path: ['metodo_otro'], message: 'Describe el otro método.' });
  if (data.metodo !== 'otro' && data.metodo_otro) ctx.addIssue({ code: 'custom', path: ['metodo_otro'], message: 'Solo aplica cuando el método es otro.' });
  if (data.fecha_siguiente_revision && data.fecha_siguiente_revision <= data.fecha) {
    ctx.addIssue({ code: 'custom', path: ['fecha_siguiente_revision'], message: 'Debe ser posterior al diagnóstico.' });
  }
});

const cria = z.strictObject({
  cria_id: idOpcional,
  sexo_capturado: z.enum(['hembra', 'macho']).optional(),
  peso_kg: cantidadPositivaOpcional,
  estado_nacimiento: z.enum(['vivo', 'muerto', 'desconocido']).default('desconocido'),
  incidencia: textoOpcional(1000),
});

const parto = z.strictObject({
  fecha_real: fechaNoFutura,
  resultado: z.enum(['parto', 'aborto', 'perdida']),
  incidencia: textoOpcional(2000),
  observaciones: textoOpcional(2000),
  responsable_id: idOpcional,
  crias: z.array(cria).max(10, 'No puede registrar más de 10 crías en una operación.').default([]),
  costo: costoDirecto,
}).superRefine((data, ctx) => {
  if (data.resultado !== 'parto' && data.crias.length) ctx.addIssue({ code: 'custom', path: ['crias'], message: 'Solo un parto puede incluir crías.' });
});

const queryDias = z.strictObject({
  dias: z.coerce.number().int().min(0).max(365).default(30),
  incluirVencidos: z.enum(['true', 'false']).optional(),
});

const filaLote = z.strictObject({
  fila: z.number().int().positive(),
  arete_vaca: z.string().trim().max(100).optional().default(''),
  arete_toro: z.string().trim().max(100).optional().default(''),
  fecha: z.string().trim().max(30).optional().default(''),
  tipo: z.string().trim().max(80).optional().default(''),
  resultado: z.string().trim().max(80).optional().default(''),
  fecha_servicio: z.string().trim().max(30).optional().default(''),
  tipo_servicio: z.string().trim().max(80).optional().default(''),
  tipo_servicio_otro: z.string().trim().max(120).optional().default(''),
  fecha_diagnostico: z.string().trim().max(30).optional().default(''),
  metodo: z.string().trim().max(80).optional().default(''),
  metodo_otro: z.string().trim().max(120).optional().default(''),
  resultado_diagnostico: z.string().trim().max(80).optional().default(''),
  fecha_parto: z.string().trim().max(30).optional().default(''),
  resultado_parto: z.string().trim().max(80).optional().default(''),
  responsable_id: idOpcional,
  observaciones: z.string().trim().max(2000).optional().default(''),
});

const lote = z.strictObject({
  import_batch_id: z.string().uuid(),
  modo: z.enum(['captura', 'importacion']),
  tipo_lote: z.enum(['servicios', 'diagnosticos', 'partos', 'historico']),
  nombre_archivo: z.string().trim().max(255).optional(),
  mapeo: z.record(z.string(), z.string()).optional().default({}),
  filas: z.array(filaLote).min(1).max(2000),
}).superRefine((data, ctx) => {
  if (data.modo === 'importacion' && data.tipo_lote !== 'historico') ctx.addIssue({ code: 'custom', path: ['tipo_lote'], message: 'La importación histórica debe usar el tipo historico.' });
  if (data.modo === 'captura' && data.tipo_lote === 'historico') ctx.addIssue({ code: 'custom', path: ['tipo_lote'], message: 'Selecciona Servicios, Diagnósticos o Partos.' });
});

const queryExportacion = z.strictObject({
  tipo: z.enum(['todos', 'servicios', 'diagnosticos', 'partos', 'ciclos']).default('todos'),
  arete: z.string().trim().max(100).optional(),
  desde: fechaOpcional(fecha),
  hasta: fechaOpcional(fecha),
  ciclo_id: idOpcional,
}).superRefine((data, ctx) => {
  if (data.desde && data.hasta && data.desde > data.hasta) ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Debe ser igual o posterior a la fecha inicial.' });
});

const camposAnalitica = {
  periodo: z.enum(['mes_actual', 'anio_actual', 'ultimos_30_dias', 'personalizado']).default('anio_actual'),
  desde: fechaOpcional(fecha),
  hasta: fechaOpcional(fecha),
  corral_id: idOpcional,
  toro_id: idOpcional,
  animal_id: idOpcional,
  estado_reproductivo: z.enum([
    'servida', 'pendiente_diagnostico', 'requiere_revision', 'prenada',
    'proxima_parto', 'vacia', 'parida', 'perdida_aborto', 'cerrado_otro',
  ]).optional(),
  tipo_servicio: tipoServicio.optional(),
};

function validarPeriodoAnalitico(data, ctx) {
  if (data.periodo === 'personalizado' && (!data.desde || !data.hasta)) {
    ctx.addIssue({ code: 'custom', path: ['desde'], message: 'El rango personalizado requiere fecha inicial y final.' });
  }
  if (data.periodo !== 'personalizado' && (data.desde || data.hasta)) {
    ctx.addIssue({ code: 'custom', path: ['periodo'], message: 'Las fechas manuales solo se aceptan con periodo personalizado.' });
  }
  if (data.desde && data.hasta && data.desde > data.hasta) {
    ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Debe ser igual o posterior a la fecha inicial.' });
  }
}

const queryAnalitica = z.strictObject(camposAnalitica).superRefine(validarPeriodoAnalitico);
const queryDetalleAnalitica = z.strictObject({
  ...camposAnalitica,
  metrica: z.enum([
    'prenadas', 'vacias', 'pendientes', 'revision', 'proximos_partos',
    'partos', 'servicios', 'tasa_prenez', 'servicios_por_concepcion', 'intervalo_partos', 'perdidas',
  ]),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
}).superRefine(validarPeriodoAnalitico);

module.exports = {
  servicio, servicioLegacy, diagnostico, parto, lote, paramsId, queryDias, queryExportacion,
  queryAnalitica, queryDetalleAnalitica,
};
