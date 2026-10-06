const {
  z, id, idOpcional, cantidadPositivaOpcional, texto, textoOpcional,
  fechaNoFutura, fechaOpcional,
} = require('./comun');

const sexo = z.enum(['hembra', 'macho'], { error: 'Debe ser hembra o macho.' });
const origen = z.enum(['nacimiento', 'compra', 'ingreso_externo'], {
  error: 'Debe ser nacimiento, compra o ingreso_externo.',
});
const origenOpcional = z.preprocess((value) => (value === '' || value === null ? undefined : value), origen.optional());

const alta = z.strictObject({
  arete_id: texto(50),
  nombre_alias: textoOpcional(100),
  sexo,
  fecha_nacimiento: fechaOpcional(fechaNoFutura),
  raza_id: idOpcional,
  madre_id: idOpcional,
  padre_id: idOpcional,
  origen: origenOpcional,
  corral_actual_id: idOpcional,
  peso_nacimiento_kg: cantidadPositivaOpcional,
});

const edicion = z.strictObject({
  nombre_alias: textoOpcional(100),
  sexo: sexo.optional(),
  fecha_nacimiento: fechaOpcional(fechaNoFutura),
  raza_id: idOpcional,
  madre_id: idOpcional,
  padre_id: idOpcional,
  peso_nacimiento_kg: cantidadPositivaOpcional,
});

const traslado = z.strictObject({
  corral_id: id,
  corral_origen_id: z.union([id, z.null()]).optional(),
  expected_version: id.optional(),
  estado_observado: z.enum(['vivo', 'vendido', 'sacrificado', 'muerto']).optional(),
  destino_ocupacion_observada: z.coerce.number().int().nonnegative().optional(),
  destino_capacidad_observada: z.coerce.number().int().positive().optional(),
});

const baja = z.strictObject({
  estado: z.enum(['sacrificado', 'muerto'], {
    error: 'Debe ser sacrificado o muerto. Las ventas deben registrarse mediante el módulo de ventas.',
  }),
  razon_baja: textoOpcional(500),
  fecha_baja: fechaOpcional(fechaNoFutura),
});

// La importación conserva el tratamiento fila por fila de aretes/sexos inválidos.
// Aquí se valida su estructura, los tipos seguros y las propiedades admitidas.
const filaImportacion = z.strictObject({
  fila: z.number().int().positive().optional(),
  arete_id: textoOpcional(50),
  nombre_alias: textoOpcional(100),
  sexo: textoOpcional(20),
  fecha_nacimiento: fechaOpcional(fechaNoFutura),
  raza: textoOpcional(100),
  peso_nacimiento_kg: cantidadPositivaOpcional,
  origen: origenOpcional,
  corral: textoOpcional(100),
});

const importacion = z.strictObject({
  animales: z.array(filaImportacion).min(1, 'Debe contener al menos un animal.').max(5000, 'No puede exceder 5000 animales por importación.'),
});

const estadoSalud = z.strictObject({
  estado_salud: z.enum(['sano', 'observacion', 'enfermo'], {
    error: 'Debe ser sano, observacion o enfermo.',
  }),
  salud_fecha_inicio: fechaOpcional(fechaNoFutura),
  salud_diagnostico: textoOpcional(2000),
  salud_tratamiento: textoOpcional(2000),
});

module.exports = { alta, edicion, traslado, baja, importacion, estadoSalud };
