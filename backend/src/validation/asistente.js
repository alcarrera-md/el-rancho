const { z, fecha, idOpcional } = require('./comun');
const { PERIODOS } = require('../periodos');

const periodo = z.enum(PERIODOS).default('anio_actual');
const identificador = z.string().trim().min(1).max(100);
const referenciaOpcional = z.string().trim().min(1).max(100).optional();
const metrica = z.enum([
  'prenadas', 'vacias', 'pendientes', 'revision', 'proximos_partos', 'partos',
  'servicios', 'tasa_prenez', 'servicios_por_concepcion', 'intervalo_partos', 'perdidas',
]);
const estadoReproductivo = z.enum([
  'servida', 'pendiente_diagnostico', 'requiere_revision', 'prenada',
  'proxima_parto', 'vacia', 'parida', 'perdida_aborto', 'cerrado_otro',
]);
const tipoServicio = z.enum(['natural', 'inseminacion_artificial', 'otro']);

const filtros = {
  periodo,
  desde: fecha.optional(),
  hasta: fecha.optional(),
  corral: referenciaOpcional,
  toro: referenciaOpcional,
  animal: referenciaOpcional,
  estado_reproductivo: estadoReproductivo.optional(),
  tipo_servicio: tipoServicio.optional(),
};

function validarPeriodo(datos, ctx) {
  if (datos.periodo === 'personalizado' && (!datos.desde || !datos.hasta)) {
    ctx.addIssue({ code: 'custom', path: ['desde'], message: 'El periodo personalizado requiere desde y hasta.' });
  }
  if (datos.periodo !== 'personalizado' && (datos.desde || datos.hasta)) {
    ctx.addIssue({ code: 'custom', path: ['periodo'], message: 'Las fechas solo se aceptan con periodo personalizado.' });
  }
  if (datos.desde && datos.hasta && datos.desde > datos.hasta) {
    ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'La fecha final debe ser igual o posterior a la inicial.' });
  }
}

const resumenReproductivo = z.strictObject({
  ...filtros,
  metricas: z.array(metrica).min(1).max(8).default(['prenadas']),
  agrupar_por: z.enum(['corral']).optional(),
}).superRefine(validarPeriodo);

const detalleReproductivo = z.strictObject({
  ...filtros,
  metrica,
  pagina: z.number().int().min(1).max(1000).default(1),
  limite: z.number().int().min(1).max(25).default(10),
}).superRefine(validarPeriodo);

const animalReproductivo = z.strictObject({ identificador });

const sementalReproductivo = z.strictObject({
  identificador,
  periodo,
  desde: fecha.optional(),
  hasta: fecha.optional(),
}).superRefine(validarPeriodo);

const limite = z.number().int().min(1).max(25).default(10);
function validarPeriodoOpcional(datos, ctx) {
  if (datos.periodo) return validarPeriodo(datos, ctx);
  if (datos.desde || datos.hasta) ctx.addIssue({ code: 'custom', path: ['periodo'], message: 'Las fechas requieren periodo personalizado.' });
}

const estadoSalud = z.enum(['sano','observacion','enfermo']);
const animalesGlobal = z.strictObject({
  modo: z.enum(['resumen', 'lista']).default('resumen'),
  sexo: z.enum(['hembra','macho']).optional(),
  categoria: z.enum(['cria','destete','engorde','vientre','reproductor','descarte']).optional(),
  etapa: z.enum(['adulto','cria']).optional(),
  estado: z.enum(['vivo','vendido','muerto','sacrificado']).optional(),
  estado_salud: estadoSalud.optional(),
  raza: referenciaOpcional,
  corral: referenciaOpcional,
  agrupar_por: z.enum(['sexo','categoria','raza','corral','estado_salud']).optional(),
  incluir_inactivos: z.boolean().default(false),
  // Solo para bajas: filtra por la fecha efectiva de baja.
  periodo: z.enum(PERIODOS).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  limite,
}).superRefine((datos, ctx) => {
  if (!datos.periodo && !datos.desde && !datos.hasta) return;
  if (!['muerto', 'vendido', 'sacrificado'].includes(datos.estado)) {
    ctx.addIssue({ code: 'custom', path: ['periodo'], message: 'El periodo solo aplica a animales dados de baja (muerto, vendido o sacrificado); los vivos son el estado actual.' });
  }
  validarPeriodoOpcional(datos, ctx);
});
const corralesGlobal = z.strictObject({ corral: referenciaOpcional, ocupacion_minima: z.number().min(0).max(100).optional() });
const inventarioGlobal = z.strictObject({ tipo: z.enum(['alimento','medicamento','vacuna','otro']).optional(), estado: z.enum(['todos','bajo','agotado','por_caducar']).default('todos'), insumo: referenciaOpcional, incluir_inactivos: z.boolean().default(false), limite: z.number().int().min(1).max(25).default(25) });
const tareasGlobal = z.strictObject({ estado: z.enum(['todas','pendiente','completada','vencida']).default('pendiente'), trabajador: referenciaOpcional, animal: referenciaOpcional, estado_salud_animal: estadoSalud.optional(), limite });
const movimientosGlobal = z.strictObject({ periodo, desde: fecha.optional(), hasta: fecha.optional(), animal: referenciaOpcional, corral_destino: referenciaOpcional, limite }).superRefine(validarPeriodo);
const finanzasGlobal = z.strictObject({ metrica: z.enum(['ventas','compras_animales','compras_insumos','gastos','egresos','leche']), periodo, desde: fecha.optional(), hasta: fecha.optional() }).superRefine(validarPeriodo);
const climaGlobal = z.strictObject({ dia: z.enum(['hoy', 'manana']).default('hoy'), enfoque: z.enum(['general', 'lluvia', 'temperatura']).default('general') });
const fichaAnimal = z.strictObject({ identificador });
// P9.3 — atención con prioridades explícitas, cruces y resumen operativo.
const sexoEtapa = { sexo: z.enum(['hembra', 'macho']).optional(), etapa: z.enum(['adulto', 'cria']).optional(), corral: referenciaOpcional };
const atencionGlobal = z.strictObject({
  ...sexoEtapa,
  prioridad: z.enum(['alta', 'media', 'baja']).optional(),
  motivo: z.enum(['enfermo', 'observacion', 'dosis_vencida', 'dosis_proxima', 'tarea_vencida', 'tarea_hoy', 'condicion_baja', 'parto_proximo']).optional(),
  limite: z.number().int().min(1).max(25).default(15),
});
const criterioCruce = z.enum(['enfermo', 'observacion', 'problema_salud', 'tarea_vencida', 'tarea_pendiente', 'dosis_vencida', 'dosis_proxima', 'condicion_baja', 'bajo_peso', 'prenada', 'proxima_parto']);
const cruceAnimales = z.strictObject({
  criterios: z.array(criterioCruce).min(1).max(4),
  ...sexoEtapa,
  agrupar_por: z.enum(['corral']).optional(),
  ordenar_por: z.enum(['animales', 'tareas']).optional(),
  limite,
}).superRefine((datos, ctx) => {
  const estados = datos.criterios.filter((c) => ['enfermo', 'observacion', 'problema_salud'].includes(c));
  if (estados.length > 1) ctx.addIssue({ code: 'custom', path: ['criterios'], message: 'Usa un solo criterio de estado de salud (enfermo, observacion o problema_salud).' });
  if (datos.ordenar_por && datos.agrupar_por !== 'corral') ctx.addIssue({ code: 'custom', path: ['ordenar_por'], message: 'ordenar_por solo aplica al agrupar por corral.' });
});
const resumenOperativo = z.strictObject({});
const trabajadoresGlobal = z.strictObject({ estado: z.enum(['activos', 'inactivos']).optional(), limite: z.number().int().min(1).max(25).default(25) });

// P9.2 — salud, peso, condición corporal, alertas y calendario (solo lectura).
const tipoEventoSalud = z.enum(['vacuna', 'tratamiento', 'diagnostico', 'desparasitacion']);
const periodoOpcional = z.enum(PERIODOS).optional();
const saludGlobal = z.strictObject({
  enfoque: z.enum(['revision', 'eventos', 'dosis']).default('eventos'),
  animal: referenciaOpcional,
  tipo: tipoEventoSalud.optional(),
  // Solo aplica a enfoque=dosis; sin valor equivale a 'pronto'.
  ventana: z.enum(['vencidas', 'hoy', 'manana', 'esta_semana', 'proximos_7_dias', 'pronto']).optional(),
  periodo: periodoOpcional,
  desde: fecha.optional(),
  hasta: fecha.optional(),
  limite,
}).superRefine(validarPeriodoOpcional);
const pesoGlobal = z.strictObject({
  animal: referenciaOpcional,
  direccion: z.enum(['bajada', 'subida']).optional(),
  periodo: periodoOpcional,
  desde: fecha.optional(),
  hasta: fecha.optional(),
  limite: z.number().int().min(1).max(25).default(5),
}).superRefine(validarPeriodoOpcional);
const condicionCorporalGlobal = z.strictObject({
  animal: referenciaOpcional,
  filtro: z.enum(['delgada', 'sobrepeso', 'bajo_puntuacion', 'subio_puntuacion']).optional(),
  puntuacion: z.number().int().min(1).max(5).optional(),
  limite: z.number().int().min(1).max(25).default(5),
});
const alertasGlobal = z.strictObject({
  severidad: z.enum(['critica', 'advertencia', 'info']).optional(),
  categoria: z.enum(['sanidad', 'reproduccion', 'inventario', 'corrales', 'trabajo', 'animales']).optional(),
  limite: z.number().int().min(1).max(25).default(15),
});
const calendarioGlobal = z.strictObject({
  periodo: z.enum(['hoy', 'manana', 'esta_semana', 'proximos_7_dias', 'proximos_30_dias', 'personalizado']).default('hoy'),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  tipo: z.enum(['vacuna', 'parto', 'tarea', 'plan_sanitario']).optional(),
  limite,
}).superRefine(validarPeriodo);

// Contexto de la última consulta verificada (P9.1). Solo transporta la tool y
// sus filtros ya validados; nunca cifras. Va firmado por el servidor y, al
// usarse, vuelve a pasar por policy.js y el esquema Zod de la tool.
const valorArgumento = z.union([
  z.string().max(120), z.number().finite(), z.boolean(), z.null(),
  z.array(z.string().max(40)).max(8),
]);
const argumentosContexto = z.record(z.string().regex(/^[a-z_]{1,40}$/), valorArgumento)
  .refine((valor) => Object.keys(valor).length <= 15, 'Demasiados filtros en el contexto.');
const opcionContexto = z.strictObject({ etiqueta: z.string().trim().min(1).max(120), valor: z.string().trim().min(1).max(100) });
const contextoConversacion = z.strictObject({
  tool: z.string().regex(/^[a-z_]{1,60}$/),
  argumentos: argumentosContexto.default({}),
  entidades: z.array(z.strictObject({
    tipo: z.enum(['animal', 'corral', 'trabajador', 'insumo']),
    valor: z.string().trim().min(1).max(100),
    etiqueta: z.string().trim().min(1).max(120),
  })).max(5).default([]),
  pendiente: z.strictObject({
    tool: z.string().regex(/^[a-z_]{1,60}$/),
    argumentos: argumentosContexto.default({}),
    campo: z.string().regex(/^[a-z_]{1,40}$/),
    opciones: z.array(opcionContexto).min(1).max(6),
  }).optional(),
  // HMAC del servidor: el cliente no puede fabricar ni alterar el contexto.
  firma: z.string().regex(/^[a-f0-9]{64}$/),
  expira_en: z.number().int().positive(),
});

const mensajeChat = z.strictObject({
  mensaje: z.string().trim().min(1).max(1000),
  // El historial solo aporta contexto: se acepta el de conversaciones largas
  // (o de clientes PWA en caché) y se recorta en servidor en vez de rechazar
  // toda la pregunta. El tope protege contra cuerpos abusivos.
  historial: z.array(z.strictObject({
    rol: z.enum(['usuario', 'asistente']),
    texto: z.string().max(8000).nullish(),
  })).max(60).default([])
    .transform((items) => items
      .map((item) => ({ rol: item.rol, texto: String(item.texto || '').trim().slice(0, 1200) }))
      .filter((item) => item.texto)
      .slice(-8)),
  // Un contexto mal formado no rechaza la pregunta: se descarta y la
  // pregunta se responde sin él.
  contexto: z.unknown().optional().transform((valor) => {
    const validado = contextoConversacion.safeParse(valor);
    return validado.success ? validado.data : null;
  }),
});

const respuestaEstructurada = z.strictObject({
  texto: z.string().trim().min(1).max(1200),
  destacado: z.object({ valor: z.union([z.string(), z.number()]), etiqueta: z.string().max(120) }).strict().optional(),
  lista: z.array(z.string().max(240)).max(8).optional(),
  tabla: z.object({
    columnas: z.array(z.string().max(80)).min(1).max(5),
    filas: z.array(z.array(z.union([z.string(), z.number(), z.null()])).max(5)).max(10),
  }).strict().optional(),
  advertencia: z.string().max(500).optional(),
});

module.exports = {
  resumenReproductivo,
  detalleReproductivo,
  animalReproductivo,
  sementalReproductivo,
  animalesGlobal, corralesGlobal, inventarioGlobal, tareasGlobal, movimientosGlobal, finanzasGlobal, climaGlobal,
  fichaAnimal, atencionGlobal,
  trabajadoresGlobal, cruceAnimales, resumenOperativo,
  saludGlobal, pesoGlobal, condicionCorporalGlobal, alertasGlobal, calendarioGlobal,
  mensajeChat,
  contextoConversacion,
  respuestaEstructurada,
};
