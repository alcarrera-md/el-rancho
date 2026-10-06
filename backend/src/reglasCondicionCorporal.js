// Regla de condición corporal (escala 1-5) que ya aplicaba la ficha del animal
// (calcularRecomendaciones): <= 2 es "delgada" y >= 5 "sobrepeso". Se centraliza
// aquí para que el asistente use exactamente el mismo criterio; no es una
// regla clínica nueva.
const CONDICION_DELGADA_MAX = 2;
const CONDICION_SOBREPESO_MIN = 5;

function clasificarCondicion(puntuacion) {
  if (puntuacion == null) return null;
  if (Number(puntuacion) <= CONDICION_DELGADA_MAX) return 'delgada';
  if (Number(puntuacion) >= CONDICION_SOBREPESO_MIN) return 'sobrepeso';
  return null;
}

module.exports = { CONDICION_DELGADA_MAX, CONDICION_SOBREPESO_MIN, clasificarCondicion };
