import { formatearAntiguedad, formatearFechaHora } from '../offline/formatoTiempo.js';

// Offline v1 Fase B §8/§10 y P8.2: aviso discreto cuando lo que se ve viene
// de IndexedDB y no de la API en vivo. Muestra la fecha exacta de la última
// sincronización para que nadie lea datos locales como si fueran actuales.
export default function IndicadorDatosLocales({ sincronizadoEn, detalle = null }) {
  const fecha = formatearFechaHora(sincronizadoEn);
  const antiguedad = formatearAntiguedad(sincronizadoEn);
  return (
    <div className="campo-datos-locales" role="status">
      {fecha ? `Datos disponibles desde la última sincronización: ${fecha}` : 'Datos guardados en este dispositivo'}
      {antiguedad && <span className="campo-datos-antiguedad"> · {antiguedad}</span>}
      {detalle && <span className="campo-datos-antiguedad"> · {detalle}</span>}
    </div>
  );
}
