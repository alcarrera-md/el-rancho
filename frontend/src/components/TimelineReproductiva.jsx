import { etiquetaCiclo } from '../reproduccionUx.js';
import { IconoCalendario, IconoCheck, IconoCorazon, IconoLista } from './Iconos.jsx';

const RESULTADO = { prenada: 'Preñada', vacia: 'Vacía', dudoso: 'Dudosa' };
const TIPO_SERVICIO = { natural: 'Servicio natural', inseminacion_artificial: 'Inseminación artificial', otro: 'Otro servicio' };

function fecha(fechaIso) {
  if (!fechaIso) return 'Sin fecha';
  return new Date(`${String(fechaIso).slice(0, 10)}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function EventosCiclo({ ciclo }) {
  const eventos = [
    ...(ciclo.servicios || []).map((registro) => ({ id: `s-${registro.id}`, fecha: registro.fecha, titulo: TIPO_SERVICIO[registro.tipo] || registro.tipo_otro || 'Servicio', detalle: registro.macho_arete ? `Toro #${registro.macho_arete}` : 'Sin toro enlazado', Icono: IconoLista })),
    ...(ciclo.diagnosticos || []).map((registro) => ({ id: `d-${registro.id}`, fecha: registro.fecha, titulo: registro.metodo === 'palpacion' ? 'Palpación' : registro.metodo === 'ecografia' ? 'Ultrasonido' : registro.metodo_otro || 'Diagnóstico', detalle: RESULTADO[registro.resultado] || registro.resultado, Icono: IconoCheck })),
    ...(ciclo.parto ? [{ id: `p-${ciclo.parto.id}`, fecha: ciclo.parto.fecha_real, titulo: ciclo.parto.resultado === 'parto' ? 'Parto' : ciclo.parto.resultado === 'aborto' ? 'Aborto' : 'Pérdida', detalle: ciclo.parto.incidencia || ciclo.estado_actual?.etiqueta, Icono: IconoCorazon }] : []),
  ].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const estimada = ciclo.estado_actual?.fecha_parto_estimada;
  if (estimada && !ciclo.parto) eventos.push({ id: 'estimada', fecha: estimada, titulo: 'Parto estimado', detalle: ciclo.estado_actual.procedencia_fecha_parto_estimada === 'manual' ? 'Fecha ajustada manualmente' : 'Fecha calculada automáticamente', futuro: true, Icono: IconoCalendario });
  return <ol className="repro-timeline-events">{eventos.map((evento) => <li key={evento.id} className={evento.futuro ? 'is-future' : ''}><span className="repro-timeline-icon" aria-hidden="true"><evento.Icono /></span><time>{fecha(evento.fecha)}</time><div><strong>{evento.titulo}</strong><span>{evento.detalle}</span></div></li>)}</ol>;
}

export default function TimelineReproductiva({ ciclos = [], legado = [] }) {
  if (!ciclos.length && !legado.length) return <div className="repro-timeline-empty"><strong>Esta vaca todavía no tiene ciclo reproductivo.</strong><span>Registra su primer servicio para comenzar el seguimiento.</span></div>;
  return <div className="repro-cycle-timeline">
    {ciclos.map((ciclo, indice) => {
      const estado = ciclo.estado_actual?.etiqueta || 'Sin estado';
      const crias = ciclo.parto?.resultado === 'parto' ? ` · ${ciclo.crias?.length || 0} cría(s)` : '';
      if (indice === 0) return <section className="repro-timeline-cycle is-current" key={ciclo.id}><header><div><span>{etiquetaCiclo(ciclo)}</span><h3>{estado}{crias}</h3></div><span className="repro-cycle-status">{ciclo.fecha_cierre ? 'Más reciente' : 'Actual'}</span></header><EventosCiclo ciclo={ciclo} /></section>;
      return <details className="repro-timeline-cycle" key={ciclo.id}><summary><span><b>{etiquetaCiclo(ciclo)}</b><small>{estado}{crias}</small></span><i>Ver ciclo</i></summary><EventosCiclo ciclo={ciclo} /></details>;
    })}
    {!!legado.length && <details className="repro-timeline-cycle is-legacy"><summary><span><b>Registros anteriores</b><small>{legado.length} evento(s) conservados</small></span><i>Ver registros</i></summary><ul>{legado.map((evento) => <li key={evento.id}>{fecha(evento.fecha_monta)} · Servicio histórico</li>)}</ul></details>}
  </div>;
}
