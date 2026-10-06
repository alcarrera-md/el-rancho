import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { agruparEventosCalendario, fechaLocalISO, separarAgenda } from '../calendario.js';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { PresentacionPantalla } from './PresentacionGuiada.jsx';
import { IconoCalendario, IconoCorazon, IconoLista, IconoSalud } from './Iconos.jsx';

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const TIPOS_EVENTO = {
  vacuna: { etiqueta: 'Vacuna', Icono: IconoSalud },
  parto: { etiqueta: 'Parto estimado', Icono: IconoCorazon },
  tarea: { etiqueta: 'Tarea', Icono: IconoLista },
  plan_sanitario: { etiqueta: 'Plan sanitario', Icono: IconoCalendario },
};

function formatearFecha(fecha, larga = false) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-MX', larga
    ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short' });
}

function ContextoEvento({ evento }) {
  const partes = [];
  if (evento.trabajador) partes.push(`Responsable: ${evento.trabajador}`);
  if (evento.corral_nombre || evento.corral) partes.push(`Corral: ${evento.corral_nombre || evento.corral}`);
  return partes.length ? <p>{partes.join(' · ')}</p> : null;
}

function EventoAgenda({ evento, onAbrirSeguimiento }) {
  const tipo = TIPOS_EVENTO[evento.tipo] || { etiqueta: 'Evento', Icono: IconoCalendario };
  const Icono = tipo.Icono;
  return (
    <article className={`calendar-agenda-event calendar-type-${evento.tipo || 'otro'}`}>
      <span className="calendar-event-icon" aria-hidden="true"><Icono width={19} height={19} /></span>
      <div className="calendar-event-copy">
        <span>{tipo.etiqueta}</span>
        <strong className={evento.tipo === 'tarea' && evento.completada ? 'calendar-completed' : ''}>{evento.titulo}</strong>
        <ContextoEvento evento={evento} />
      </div>
      {evento.animal_id && <button className="btn btn-ghost" onClick={() => onAbrirSeguimiento(evento.animal_id)}>Ver animal</button>}
    </article>
  );
}

function GrupoAgenda({ fecha, eventos, titulo, onAbrirSeguimiento, idBase = 'agenda' }) {
  const tituloId = `${idBase}-${fecha}`;
  return (
    <section className="calendar-agenda-day" aria-labelledby={tituloId}>
      <div className="calendar-agenda-date">
        <h2 id={tituloId}>{titulo || formatearFecha(fecha)}</h2>
        <span>{eventos.length} {eventos.length === 1 ? 'evento' : 'eventos'}</span>
      </div>
      {eventos.length === 0
        ? <EstadoVacio titulo="Nada programado" descripcion="No hay actividades registradas para este día." compacto />
        : <div className="calendar-agenda-events">{eventos.map((evento, indice) => <EventoAgenda key={`${evento.tipo}-${evento.fecha}-${evento.animal_id || evento.titulo}-${indice}`} evento={evento} onAbrirSeguimiento={onAbrirSeguimiento} />)}</div>}
    </section>
  );
}

export default function Calendario({ onAbrirSeguimiento }) {
  const hoy = useMemo(() => new Date(), []);
  const claveHoy = fechaLocalISO(hoy);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth());
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState(null);
  const [diaSeleccionado, setDiaSeleccionado] = useState(claveHoy);

  function cargar() {
    const desde = fechaLocalISO(new Date(anio, mes, 1));
    const hasta = fechaLocalISO(new Date(anio, mes + 1, 0));
    setError(null);
    setEventos(null);
    return api.obtenerCalendario(desde, hasta).then(setEventos).catch((err) => setError(err.message));
  }

  useEffect(() => { cargar(); }, [anio, mes]); // eslint-disable-line react-hooks/exhaustive-deps

  function cambiarMes(delta) {
    const destino = new Date(anio, mes + delta, 1);
    setAnio(destino.getFullYear());
    setMes(destino.getMonth());
    setDiaSeleccionado(fechaLocalISO(destino));
  }

  function irAHoy() {
    setAnio(hoy.getFullYear());
    setMes(hoy.getMonth());
    setDiaSeleccionado(claveHoy);
  }

  function seleccionarFecha(valor) {
    if (!valor) return;
    const [nuevoAnio, nuevoMes] = valor.split('-').map(Number);
    setDiaSeleccionado(valor);
    setAnio(nuevoAnio);
    setMes(nuevoMes - 1);
  }

  const eventosPorDia = useMemo(() => agruparEventosCalendario(eventos || []), [eventos]);
  const agenda = useMemo(() => separarAgenda(eventos || [], claveHoy), [eventos, claveHoy]);
  const esMesActual = anio === hoy.getFullYear() && mes === hoy.getMonth();
  const primerDiaMes = new Date(anio, mes, 1);
  const diasEnMes = new Date(anio, mes + 1, 0).getDate();
  const celdas = [...Array(primerDiaMes.getDay()).fill(null), ...Array.from({ length: diasEnMes }, (_, indice) => indice + 1)];
  const prefijoMes = `${anio}-${String(mes + 1).padStart(2, '0')}`;
  const fechaSelector = diaSeleccionado?.startsWith(prefijoMes) ? diaSeleccionado : fechaLocalISO(primerDiaMes);
  const diasAgenda = esMesActual ? agenda.proximos : Object.entries(eventosPorDia);

  return (
    <div className="calendar-page">
      <PresentacionPantalla
        etiqueta="Agenda del rancho"
        titulo="Qué viene después"
        descripcion="Revisa lo programado para hoy y anticipa vacunas, partos, tareas y actividades sanitarias."
      />

      <div className="calendar-controls" aria-label="Navegación del calendario">
        <button className="btn btn-ghost calendar-arrow" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">←</button>
        <div aria-live="polite"><strong>{MESES[mes]} {anio}</strong><span>{eventos?.length ?? '—'} eventos registrados</span></div>
        <button className="btn btn-ghost calendar-arrow" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">→</button>
        <button className="btn btn-ghost calendar-today" onClick={irAHoy}>Ir a hoy</button>
      </div>

      <div className="calendar-date-picker field">
        <label htmlFor="calendario-fecha">Abrir una fecha</label>
        <input id="calendario-fecha" className="input" type="date" value={fechaSelector} onChange={(evento) => seleccionarFecha(evento.target.value)} />
      </div>

      <div className="calendar-legend" aria-label="Tipos de evento">
        {Object.entries(TIPOS_EVENTO).map(([tipo, configuracion]) => <span key={tipo} className={`calendar-type-${tipo}`}><i aria-hidden="true" />{configuracion.etiqueta}</span>)}
      </div>

      {error && <EstadoError mensaje={error} onReintentar={cargar} />}
      {!eventos && !error && <div className="card"><EstadoCarga mensaje="Preparando la agenda del mes…" /></div>}

      {eventos && <>
        <div className="calendar-month-view card" aria-label={`Calendario de ${MESES[mes]} de ${anio}`}>
          <div className="calendar-weekdays">{DIAS_SEMANA.map((dia) => <span key={dia}>{dia}</span>)}</div>
          <div className="calendar-grid">
            {celdas.map((dia, indice) => {
              if (dia === null) return <span key={`vacio-${indice}`} aria-hidden="true" />;
              const fecha = fechaLocalISO(new Date(anio, mes, dia));
              const eventosDelDia = eventosPorDia[fecha] || [];
              return (
                <button
                  key={fecha}
                  className={`calendar-day ${fecha === claveHoy ? 'today' : ''} ${diaSeleccionado === fecha ? 'selected' : ''}`}
                  onClick={() => setDiaSeleccionado(fecha)}
                  aria-label={`${formatearFecha(fecha, true)}: ${eventosDelDia.length} eventos`}
                  aria-pressed={diaSeleccionado === fecha}
                >
                  <strong>{dia}</strong>
                  <span className="calendar-tablet-count">{eventosDelDia.length || ''}</span>
                  <span className="calendar-day-events">
                    {eventosDelDia.slice(0, 3).map((evento, eventoIndice) => <span key={`${evento.tipo}-${eventoIndice}`} className={`calendar-event-pill calendar-type-${evento.tipo}`}><i aria-hidden="true" /><span>{evento.titulo}</span></span>)}
                    {eventosDelDia.length > 3 && <small>+{eventosDelDia.length - 3} más</small>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="calendar-selected-detail">
          <GrupoAgenda fecha={fechaSelector} eventos={eventosPorDia[fechaSelector] || []} titulo={formatearFecha(fechaSelector, true)} onAbrirSeguimiento={onAbrirSeguimiento} idBase="agenda-seleccion" />
        </div>

        <div className="calendar-mobile-agenda">
          {esMesActual && <GrupoAgenda fecha={claveHoy} eventos={agenda.hoy} titulo="Hoy" onAbrirSeguimiento={onAbrirSeguimiento} idBase="agenda-hoy" />}
          <div className="calendar-agenda-heading"><h2>{esMesActual ? 'Lo que viene después' : `Agenda de ${MESES[mes]}`}</h2><p>Eventos agrupados por día, en orden cronológico.</p></div>
          {diasAgenda.length === 0
            ? <div className="card"><EstadoVacio titulo="No hay más eventos este mes" descripcion="Puedes avanzar al mes siguiente para continuar revisando la agenda." /></div>
            : diasAgenda.map(([fecha, eventosDelDia]) => <GrupoAgenda key={fecha} fecha={fecha} eventos={eventosDelDia} onAbrirSeguimiento={onAbrirSeguimiento} idBase="agenda-proximo" />)}
          {esMesActual && agenda.anteriores.length > 0 && <details className="calendar-past"><summary>Ver eventos anteriores del mes</summary>{agenda.anteriores.map(([fecha, eventosDelDia]) => <GrupoAgenda key={fecha} fecha={fecha} eventos={eventosDelDia} onAbrirSeguimiento={onAbrirSeguimiento} idBase="agenda-anterior" />)}</details>}
        </div>

      </>}
    </div>
  );
}
