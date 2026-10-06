const { crearError, integracion } = require('./errors');

const CLIMA_TIMEOUT_MS = 8000;
const ETIQUETAS_DIA = ['Hoy', 'Mañana', 'Pasado mañana', 'En 3 días', 'En 4 días'];
let cache = { clave: null, datos: null, expira: 0 };

function errorUbicacion(lat, lon) {
  const faltaLat = lat === null || lat === undefined || String(lat).trim() === '';
  const faltaLon = lon === null || lon === undefined || String(lon).trim() === '';
  if (faltaLat || faltaLon) {
    return crearError('CLIMA_UBICACION_FALTANTE', 'Configura la ubicación del rancho para ver el clima.', 422);
  }
  const latitud = Number(lat);
  const longitud = Number(lon);
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud)
      || latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
    return crearError('CLIMA_CONFIG_INVALIDA', 'La ubicación configurada para el clima no es válida.', 422);
  }
  return { latitud, longitud };
}

function validarRespuesta(datos) {
  if (!datos || !Array.isArray(datos.list) || datos.list.length === 0) return false;
  return datos.list.every((bloque) => {
    const fechaValida = typeof bloque?.dt_txt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(bloque.dt_txt);
    const descripcion = bloque?.weather?.[0]?.description;
    return fechaValida
      && Number.isFinite(Number(bloque?.main?.temp))
      && Number.isFinite(Number(bloque?.wind?.speed))
      && typeof descripcion === 'string' && descripcion.trim().length > 0;
  });
}

async function solicitarPronostico(lat, lon, { fetchImpl = fetch, timeoutMs = CLIMA_TIMEOUT_MS, apiKey = process.env.OPENWEATHERMAP_API_KEY } = {}) {
  const ubicacion = errorUbicacion(lat, lon);
  if (ubicacion instanceof Error) throw ubicacion;
  if (!apiKey || !String(apiKey).trim()) {
    throw crearError('CLIMA_CONFIG_INVALIDA', 'El servicio del clima no está configurado correctamente.', 503);
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  const url = new URL('https://api.openweathermap.org/data/2.5/forecast');
  url.search = new URLSearchParams({
    lat: String(ubicacion.latitud), lon: String(ubicacion.longitud), appid: apiKey,
    units: 'metric', lang: 'es',
  });

  let respuesta;
  try {
    respuesta = await fetchImpl(url, { signal: controlador.signal });
  } catch (causa) {
    if (controlador.signal.aborted || causa?.name === 'AbortError' || causa?.name === 'TimeoutError') {
      throw integracion('CLIMA_TIMEOUT', 'El servicio del clima no respondió a tiempo.', causa);
    }
    throw integracion('CLIMA_TRANSPORTE_ERROR', 'No fue posible conectar con el proveedor del clima.', causa);
  } finally {
    clearTimeout(temporizador);
  }

  if (!respuesta.ok) {
    // El detalle del proveedor puede contener información operativa; se
    // conserva sólo como causa privada y nunca se devuelve al cliente.
    const cuerpo = await respuesta.json().catch(() => ({}));
    const causa = new Error(typeof cuerpo?.message === 'string' ? cuerpo.message : `HTTP ${respuesta.status}`);
    causa.status = respuesta.status;
    throw integracion('CLIMA_PROVEEDOR_RECHAZO', 'El proveedor del clima rechazó la solicitud.', causa);
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch (causa) {
    throw integracion('CLIMA_RESPUESTA_INVALIDA', 'El proveedor devolvió una respuesta de clima inválida.', causa);
  }
  if (!validarRespuesta(datos)) {
    throw integracion('CLIMA_RESPUESTA_INVALIDA', 'El proveedor devolvió una respuesta de clima inválida.');
  }
  return datos;
}

async function obtenerPronostico(lat, lon, opciones = {}) {
  const clave = `${lat},${lon}`;
  if (!opciones.sinCache && cache.clave === clave && cache.expira > Date.now()) return cache.datos;
  const datos = await solicitarPronostico(lat, lon, opciones);
  const porDia = {};
  for (const bloque of datos.list) {
    const fecha = bloque.dt_txt.slice(0, 10);
    if (!porDia[fecha]) porDia[fecha] = { fecha, temps: [], pops: [], vientos: [], descripciones: [] };
    porDia[fecha].temps.push(Number(bloque.main.temp));
    porDia[fecha].pops.push(Number(bloque.pop || 0));
    porDia[fecha].vientos.push(Number(bloque.wind.speed) * 3.6);
    porDia[fecha].descripciones.push(bloque.weather[0].description);
  }
  const dias = Object.values(porDia).slice(0, 4).map((dia, indice) => {
    const descripcion = dia.descripciones.sort((a, b) => dia.descripciones.filter((valor) => valor === b).length - dia.descripciones.filter((valor) => valor === a).length)[0];
    return {
      fecha: dia.fecha,
      etiqueta: ETIQUETAS_DIA[indice] || `Día ${indice + 1}`,
      descripcion: descripcion.charAt(0).toUpperCase() + descripcion.slice(1),
      temp_max: Math.round(Math.max(...dia.temps)), temp_min: Math.round(Math.min(...dia.temps)),
      prob_lluvia: Math.round(Math.max(...dia.pops) * 100), viento_max: Math.round(Math.max(...dia.vientos)),
    };
  });
  if (!opciones.sinCache) cache = { clave, datos: dias, expira: Date.now() + 30 * 60 * 1000 };
  return dias;
}

function calcularRecomendacionesClima(dias) {
  const recomendaciones = [];
  for (const dia of dias) {
    if (dia.prob_lluvia >= 60) recomendaciones.push({ dia: dia.etiqueta, tipo: 'lluvia', mensaje: `${dia.etiqueta} hay ${dia.prob_lluvia}% de probabilidad de lluvia. Revisa el drenaje de los corrales y considera resguardar a los becerros.` });
    if (dia.temp_max >= 35) recomendaciones.push({ dia: dia.etiqueta, tipo: 'calor', mensaje: `${dia.etiqueta} se esperan ${dia.temp_max}°C. Asegura suficiente agua fresca y sombra disponible para el ganado.` });
    if (dia.temp_min <= 5) recomendaciones.push({ dia: dia.etiqueta, tipo: 'frio', mensaje: `${dia.etiqueta} la temperatura puede bajar a ${dia.temp_min}°C. Protege a las crías recién nacidas y a los animales más débiles del frío.` });
    if (dia.viento_max >= 40) recomendaciones.push({ dia: dia.etiqueta, tipo: 'viento', mensaje: `${dia.etiqueta} se esperan vientos de hasta ${dia.viento_max} km/h. Revisa que cercas, láminas y estructuras estén bien aseguradas.` });
  }
  return recomendaciones;
}

module.exports = { CLIMA_TIMEOUT_MS, errorUbicacion, solicitarPronostico, validarRespuesta, obtenerPronostico, calcularRecomendacionesClima };
