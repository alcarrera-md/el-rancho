const { z } = require('zod');

const quitarVacio = (value) => (value === '' ? undefined : value);
const quitarVacioONull = (value) => (value === '' || value === null ? undefined : value);

function convertirNumero(value) {
  if (typeof value === 'string' && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return value;
}

function numero(esquema) {
  return z.preprocess((value) => convertirNumero(value), esquema);
}

function numeroOpcional(esquema) {
  return z.preprocess(
    (value) => convertirNumero(quitarVacioONull(value)),
    esquema.optional()
  );
}

const id = numero(z.number().int('Debe ser un número entero.').positive('Debe ser un identificador positivo.'));
const idOpcional = numeroOpcional(z.number().int('Debe ser un número entero.').positive('Debe ser un identificador positivo.'));
const cantidadPositiva = numero(z.number().finite().positive('Debe ser mayor que cero.'));
const cantidadPositivaOpcional = numeroOpcional(z.number().finite().positive('Debe ser mayor que cero.'));
const montoNoNegativo = numero(z.number().finite().min(0, 'Debe ser mayor o igual a cero.'));
const montoNoNegativoOpcional = numeroOpcional(z.number().finite().min(0, 'Debe ser mayor o igual a cero.'));

function texto(maximo, mensaje = `No debe exceder ${maximo} caracteres.`) {
  return z.string().trim().min(1, 'No puede estar vacío.').max(maximo, mensaje);
}

function textoOpcional(maximo) {
  return z.preprocess(
    quitarVacioONull,
    z.string().trim().max(maximo, `No debe exceder ${maximo} caracteres.`).optional()
  );
}

function esFechaISOValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const fecha = z.string()
  .refine(esFechaISOValida, 'Debe ser una fecha válida con formato AAAA-MM-DD.');

const fechaNoFutura = fecha.refine(
  (value) => value <= new Date().toISOString().slice(0, 10),
  'No puede ser una fecha futura.'
);

function fechaOpcional(esquema = fecha) {
  return z.preprocess(quitarVacioONull, esquema.optional());
}

const paramsId = z.strictObject({ id });

const idsUnicos = z.array(id)
  .min(1, 'Debe contener al menos un identificador.')
  .superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: 'custom', message: 'No debe contener identificadores duplicados.' });
    }
  });

module.exports = {
  z,
  id,
  idOpcional,
  paramsId,
  idsUnicos,
  cantidadPositiva,
  cantidadPositivaOpcional,
  montoNoNegativo,
  montoNoNegativoOpcional,
  texto,
  textoOpcional,
  fecha,
  fechaNoFutura,
  fechaOpcional,
  numeroOpcional,
};
