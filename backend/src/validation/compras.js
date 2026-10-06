const {
  z, id, idOpcional, montoNoNegativoOpcional, cantidadPositiva,
  texto, textoOpcional, fecha, fechaNoFutura, fechaOpcional, cantidadPositivaOpcional,
} = require('./comun');

const compraAnimal = z.strictObject({
  animal_id: id,
  tercero_id: id,
  fecha: fechaOpcional(fecha),
  precio: montoNoNegativoOpcional,
  identificacion_previa: textoOpcional(100),
});

const compraAnimalNuevo = z.strictObject({
  arete_id: texto(50),
  sexo: z.enum(['hembra', 'macho'], { error: 'Debe ser hembra o macho.' }),
  nombre_alias: textoOpcional(100),
  fecha_nacimiento: fechaOpcional(fechaNoFutura),
  raza_id: idOpcional,
  peso_nacimiento_kg: cantidadPositivaOpcional,
  corral_id: idOpcional,
  tercero_id: id,
  fecha: fechaOpcional(fecha),
  precio: montoNoNegativoOpcional,
  identificacion_previa: textoOpcional(100),
});

const compraInsumo = z.strictObject({
  insumo_id: id,
  tercero_id: id,
  fecha: fechaOpcional(fecha),
  cantidad: cantidadPositiva,
  costo_total: montoNoNegativoOpcional,
});

module.exports = { compraAnimal, compraAnimalNuevo, compraInsumo };
