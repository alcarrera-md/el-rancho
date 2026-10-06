const { obtenerConfiguracion } = require('./configuracion');
const { obtenerPronostico } = require('./clima');
const { fechaISOEnZona } = require('./periodos');

function sumarDia(fecha) {
  const valor = new Date(`${fecha}T00:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + 1);
  return valor.toISOString().slice(0, 10);
}

// Reutiliza el mismo servicio y caché que el tablero. El día se elige por
// fecha local del rancho, no por posición: de noche el primer bloque del
// proveedor ya puede corresponder a mañana.
async function consultarClima(_db, args, opciones = {}) {
  const configuracion = await obtenerConfiguracion();
  const dias = await obtenerPronostico(configuracion.ubicacion_lat, configuracion.ubicacion_lon);
  const hoy = fechaISOEnZona(opciones.ahora || new Date());
  const fecha = args.dia === 'manana' ? sumarDia(hoy) : hoy;
  const pronostico = dias.find((dia) => dia.fecha === fecha) || null;
  return {
    dia: args.dia,
    enfoque: args.enfoque,
    fecha,
    pronostico: pronostico ? { ...pronostico, etiqueta: args.dia === 'manana' ? 'Mañana' : 'Hoy' } : null,
    advertencia: 'Pronóstico del proveedor agrupado por día; las cifras son máximos y mínimos de sus bloques de 3 horas.',
    fuente: 'OpenWeatherMap mediante el módulo de clima de El Rancho',
  };
}

module.exports = { consultarClima };
