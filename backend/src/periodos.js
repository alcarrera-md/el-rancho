const ZONA_HORARIA_RANCHO = 'America/Mexico_City';

// Única fuente de verdad para los periodos que entiende el asistente. Toda
// tool recibe la clave canónica y resuelve el rango con normalizarPeriodoFrecuente.
const PERIODOS = Object.freeze([
  'hoy', 'ayer', 'manana', 'esta_semana', 'ultimos_7_dias', 'mes_actual', 'mes_pasado',
  'anio_actual', 'anio_pasado', 'ultimos_30_dias', 'proximos_7_dias', 'proximos_30_dias', 'personalizado',
]);

const FRASES_PERIODO = Object.freeze({
  hoy: 'hoy',
  ayer: 'ayer',
  manana: 'manana',
  'esta semana': 'esta_semana',
  'semana actual': 'esta_semana',
  'ultimos 7 dias': 'ultimos_7_dias',
  'ultima semana': 'ultimos_7_dias',
  'este mes': 'mes_actual',
  'mes actual': 'mes_actual',
  'mes pasado': 'mes_pasado',
  'el mes pasado': 'mes_pasado',
  'mes anterior': 'mes_pasado',
  'este ano': 'anio_actual',
  'ano actual': 'anio_actual',
  ano_actual: 'anio_actual',
  'ano pasado': 'anio_pasado',
  'el ano pasado': 'anio_pasado',
  'ano anterior': 'anio_pasado',
  ano_pasado: 'anio_pasado',
  'ultimos 30 dias': 'ultimos_30_dias',
  'proximos 7 dias': 'proximos_7_dias',
  'proxima semana': 'proximos_7_dias',
  'proximos 30 dias': 'proximos_30_dias',
});

function limpiar(valor) {
  return String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function fechaISOEnZona(valor = new Date(), zonaHoraria = ZONA_HORARIA_RANCHO) {
  if (!(valor instanceof Date)) return String(valor).slice(0, 10);
  if (valor.getUTCHours() === 0 && valor.getUTCMinutes() === 0 && valor.getUTCSeconds() === 0 && valor.getUTCMilliseconds() === 0) {
    return valor.toISOString().slice(0, 10);
  }
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(valor);
  const dato = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${dato.year}-${dato.month}-${dato.day}`;
}

// Devuelve la fecha local del rancho como medianoche UTC. Los servicios que
// calculan con toISOString (p. ej. la analítica reproductiva) quedan así
// alineados con la misma fecha que usan las demás tools.
function ahoraAnclado(ahora = new Date()) {
  return new Date(`${fechaISOEnZona(ahora)}T00:00:00Z`);
}

function desplazarDias(fecha, dias) {
  const valor = new Date(`${fecha}T00:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

function finDeMes(fecha) {
  const [anio, mes] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

function inicioSemana(fecha) {
  // Semana de lunes a domingo, igual que el calendario operativo.
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return desplazarDias(fecha, -((dia + 6) % 7));
}

function clavePeriodo(valor) {
  const limpio = limpiar(valor);
  return FRASES_PERIODO[limpio] || FRASES_PERIODO[limpio.replaceAll('_', ' ')] || limpio;
}

function normalizarPeriodoFrecuente(valor, ahora = new Date(), personalizado = {}) {
  const periodo = clavePeriodo(valor || 'anio_actual');
  const hoy = fechaISOEnZona(ahora);
  const anio = Number(hoy.slice(0, 4));
  if (periodo === 'hoy') return { periodo, desde: hoy, hasta: hoy };
  if (periodo === 'manana') { const manana = desplazarDias(hoy, 1); return { periodo, desde: manana, hasta: manana }; }
  if (periodo === 'ayer') { const ayer = desplazarDias(hoy, -1); return { periodo, desde: ayer, hasta: ayer }; }
  if (periodo === 'esta_semana') { const lunes = inicioSemana(hoy); return { periodo, desde: lunes, hasta: desplazarDias(lunes, 6) }; }
  if (periodo === 'ultimos_7_dias') return { periodo, desde: desplazarDias(hoy, -6), hasta: hoy };
  if (periodo === 'mes_actual') return { periodo, desde: `${hoy.slice(0, 7)}-01`, hasta: finDeMes(hoy) };
  if (periodo === 'mes_pasado') {
    const fin = desplazarDias(`${hoy.slice(0, 7)}-01`, -1);
    return { periodo, desde: `${fin.slice(0, 7)}-01`, hasta: fin };
  }
  if (periodo === 'anio_actual') return { periodo, desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
  if (periodo === 'anio_pasado') return { periodo, desde: `${anio - 1}-01-01`, hasta: `${anio - 1}-12-31` };
  if (periodo === 'ultimos_30_dias') return { periodo, desde: desplazarDias(hoy, -29), hasta: hoy };
  if (periodo === 'proximos_7_dias') return { periodo, desde: hoy, hasta: desplazarDias(hoy, 7) };
  if (periodo === 'proximos_30_dias') return { periodo, desde: hoy, hasta: desplazarDias(hoy, 30) };
  if (periodo === 'personalizado') return { periodo, desde: personalizado.desde, hasta: personalizado.hasta };
  return { periodo, desde: personalizado.desde, hasta: personalizado.hasta };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function desplazarMeses(fecha, meses) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const destino = new Date(Date.UTC(anio, mes - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(dia, ultimo));
  return destino.toISOString().slice(0, 10);
}

function fechaValida(anio, mes, dia) {
  const valor = new Date(Date.UTC(anio, mes - 1, dia));
  return valor.getUTCFullYear() === anio && valor.getUTCMonth() === mes - 1 && valor.getUTCDate() === dia ? valor.toISOString().slice(0, 10) : null;
}

// Interpreta en backend una frase de periodo ya normalizada (minúsculas, sin
// acentos): "hoy", "este mes", "el mes pasado", "los ultimos 3 meses",
// "ultimos 15 dias", "la ultima semana", "el ultimo mes", "del 1 al 7 de
// octubre", "del 1 de agosto al 15 de septiembre", "del 2026-08-01 al 2026-09-15".
// Devuelve { periodo, desde?, hasta? } o null; nunca adivina fechas inválidas.
// "Últimos N días" incluye hoy (igual que ultimos_7_dias); "últimos N meses"
// va de la misma fecha N meses atrás hasta hoy.
function interpretarFrasePeriodo(frase, ahora = new Date()) {
  const texto = limpiar(frase).replace(/^(?:(?:en|de|del|durante|para|desde)\s+)?(?:(?:el|la|los|las)\s+)?/, '').trim();
  if (!texto) return null;
  const directa = FRASES_PERIODO[texto];
  if (directa) return { periodo: directa };
  const hoy = fechaISOEnZona(ahora);
  if (/^(ultimo mes|mes)$/.test(texto)) return { periodo: 'ultimos_30_dias' };
  const ultimos = texto.match(/^ultim[oa]s? (\d{1,3}) (dias?|semanas?|mes(?:es)?)$/);
  if (ultimos) {
    const n = Number(ultimos[1]);
    if (n < 1 || (ultimos[2].startsWith('mes') && n > 36) || (!ultimos[2].startsWith('mes') && n > 1100)) return null;
    const desde = ultimos[2].startsWith('dia') ? desplazarDias(hoy, -(n - 1))
      : ultimos[2].startsWith('semana') ? desplazarDias(hoy, -(n * 7 - 1)) : desplazarMeses(hoy, -n);
    return { periodo: 'personalizado', desde, hasta: hoy };
  }
  const anio = Number(hoy.slice(0, 4));
  const iso = texto.match(/^(\d{4}-\d{2}-\d{2}) (?:al|a|hasta|y) (?:el )?(\d{4}-\d{2}-\d{2})$/);
  if (iso) {
    const [desde, hasta] = [iso[1], iso[2]].map((f) => fechaValida(...f.split('-').map(Number)));
    return desde && hasta && desde <= hasta ? { periodo: 'personalizado', desde, hasta } : null;
  }
  const meses = MESES.join('|');
  const rango = texto.match(new RegExp(`^(\\d{1,2})(?: de (${meses}|setiembre))? (?:al|a|hasta|y) (?:el )?(\\d{1,2}) de (${meses}|setiembre)(?: de (\\d{4}))?$`));
  if (rango) {
    const mesFin = MESES.indexOf(rango[4] === 'setiembre' ? 'septiembre' : rango[4]) + 1;
    const mesInicio = rango[2] ? MESES.indexOf(rango[2] === 'setiembre' ? 'septiembre' : rango[2]) + 1 : mesFin;
    const anioFin = rango[5] ? Number(rango[5]) : anio;
    const anioInicio = mesInicio > mesFin ? anioFin - 1 : anioFin;
    const desde = fechaValida(anioInicio, mesInicio, Number(rango[1]));
    const hasta = fechaValida(anioFin, mesFin, Number(rango[3]));
    return desde && hasta && desde <= hasta ? { periodo: 'personalizado', desde, hasta } : null;
  }
  return null;
}

function normalizarArgumentosTemporales(argumentos = {}) {
  if (!Object.hasOwn(argumentos, 'periodo')) return argumentos;
  const periodo = clavePeriodo(argumentos.periodo);
  if (periodo === 'personalizado') return { ...argumentos, periodo };
  const { desde, hasta, ...resto } = argumentos;
  return { ...resto, periodo };
}

module.exports = {
  ZONA_HORARIA_RANCHO, PERIODOS, ahoraAnclado, clavePeriodo, fechaISOEnZona,
  normalizarPeriodoFrecuente, normalizarArgumentosTemporales, interpretarFrasePeriodo,
};
