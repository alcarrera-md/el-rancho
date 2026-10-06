// UX mínima offline (§10): "Datos actualizados hace 37 min" en vez de un
// timestamp crudo. Deliberadamente aproximado (minutos/horas/días
// redondeados) — no es un reloj de precisión, es una señal de frescura.
export function formatearAntiguedad(timestampISO, ahora = new Date()) {
  if (!timestampISO) return null;
  const ms = ahora.getTime() - new Date(timestampISO).getTime();
  if (ms < 60_000) return 'hace un momento';
  const minutos = Math.round(ms / 60_000);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

const dos = (valor) => String(valor).padStart(2, '0');

// Fecha y hora exacta de la última sincronización en la hora del dispositivo:
// "23/09/2026 18:42". El usuario debe saber de cuándo son los datos.
export function formatearFechaHora(timestampISO) {
  if (!timestampISO) return null;
  const fecha = new Date(timestampISO);
  if (Number.isNaN(fecha.getTime())) return null;
  return `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

// Fechas de negocio (DATE de PostgreSQL, "AAAA-MM-DD"): se formatean sin
// pasar por Date para que la zona horaria no las mueva un día.
export function formatearFechaNegocio(valor) {
  if (!valor) return null;
  const texto = String(valor);
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (coincidencia && (texto.length === 10 || !/T\d{2}:\d{2}.*Z$/.test(texto))) return `${coincidencia[3]}/${coincidencia[2]}/${coincidencia[1]}`;
  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}
