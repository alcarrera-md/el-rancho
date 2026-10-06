import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAlertas } from '../context/AlertasContext.jsx';
import EstadoSaludBadge from './EstadoSaludBadge.jsx';
import PlanesSanitarios from './PlanesSanitarios.jsx';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { EncabezadoDetalle, PresentacionPantalla, SelectorDetalle } from './PresentacionGuiada.jsx';
import { IconoCampana, IconoCalendario, IconoClinica, IconoOjo, IconoSalud, IconoVacuna } from './Iconos.jsx';

const TIPOS_TRATAMIENTO = ['tratamiento', 'desparasitacion'];

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function TablaEventos({ eventos, vacio, onAbrirSeguimiento }) {
  if (!eventos) return <EstadoCarga mensaje="Cargando eventos de salud…" />;
  if (eventos.length === 0) return <EstadoVacio titulo={vacio} descripcion="No hay acciones pendientes para este grupo." compacto />;
  return (
    <div className="health-record-list">
      {eventos.slice(0, 8).map((e) => (
        <article className="health-record" key={e.id}>
          <span className="health-record-mark"><IconoSalud /></span>
          <div className="health-record-animal"><strong>{e.nombre_alias || 'Sin alias'}</strong><span className="tag-badge">{e.arete_id}</span></div>
          <div className="health-record-context"><small>Motivo o estado</small><strong>{e.enfermedad || e.descripcion || 'Seguimiento sanitario'}</strong></div>
          <time><small>{e.proxima_dosis ? 'Próxima acción' : 'Registrado'}</small><strong>{formatearFecha(e.proxima_dosis || e.fecha)}</strong></time>
          <button className="btn btn-ghost btn-table-action" onClick={() => onAbrirSeguimiento(e.animal_id)}>Abrir seguimiento</button>
        </article>
      ))}
    </div>
  );
}

function ListaAnimales({ animales, vacio, onAbrirSeguimiento, ultimoEventoPorAnimal }) {
  if (!animales) return <EstadoCarga mensaje="Cargando animales…" />;
  if (animales.length === 0) return <EstadoVacio titulo={vacio} descripcion="No hay animales que requieran atención en este momento." compacto />;
  return (
    <div className="health-record-list">
      {animales.map((a) => {
        const ultimoEvento = ultimoEventoPorAnimal?.get(String(a.id));
        return (
          <article className="health-record" key={a.id}>
            <span className="health-record-mark"><IconoOjo /></span>
            <div className="health-record-animal"><strong>{a.nombre_alias || 'Sin alias'}</strong><span className="tag-badge">{a.arete_id}</span></div>
            <div className="health-record-context"><small>Ubicación</small><strong>{a.corral_actual || 'Sin corral'}</strong></div>
            <div className="health-record-state"><EstadoSaludBadge estado={a.estado} estadoSalud={a.estado_salud} tamano="chico" />{ultimoEvento?.fecha && <small>Último registro: {formatearFecha(ultimoEvento.fecha)}</small>}</div>
            <button className="btn btn-ghost btn-table-action" onClick={() => onAbrirSeguimiento(a.id)}>Abrir seguimiento</button>
          </article>
        );
      })}
    </div>
  );
}

export default function Sanidad({ onAbrirSeguimiento }) {
  const { resumen } = useAlertas() || {};
  const [proximas, setProximas] = useState(null);
  const [eventosSalud, setEventosSalud] = useState(null);
  const [enfermos, setEnfermos] = useState(null);
  const [observacion, setObservacion] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('atencion');

  function cargar() {
    setError(null);
    Promise.all([
      api.proximasVacunas(30), api.listarSalud(),
      api.listarAnimales({ estado: 'vivo', estado_salud: 'enfermo' }),
      api.listarAnimales({ estado: 'vivo', estado_salud: 'observacion' }),
    ]).then(([proximos, eventos, animalesEnfermos, animalesObservacion]) => {
      setProximas(proximos); setEventosSalud(eventos); setEnfermos(animalesEnfermos); setObservacion(animalesObservacion);
    }).catch((err) => setError(err.message));
  }
  useEffect(cargar, []); // eslint-disable-line react-hooks/exhaustive-deps

  const vacunas = (proximas || []).filter((e) => e.tipo === 'vacuna');
  const revisiones = (proximas || []).filter((e) => e.tipo === 'diagnostico');
  const tratamientos = (eventosSalud || []).filter((e) => TIPOS_TRATAMIENTO.includes(e.tipo));
  const ultimoEventoPorAnimal = new Map();
  for (const evento of eventosSalud || []) {
    const clave = String(evento.animal_id);
    if (!ultimoEventoPorAnimal.has(clave)) ultimoEventoPorAnimal.set(clave, evento);
  }

  return (
    <div className="health-screen">
      <PresentacionPantalla
        etiqueta="Salud del hato"
        titulo="Centro veterinario"
        descripcion="Separa la atención clínica inmediata del trabajo preventivo para decidir rápidamente qué animal revisar primero."
        icono={IconoClinica}
        acento="alerta"
        className="health-module-header"
      />

      {error && <EstadoError mensaje={error} onReintentar={cargar} />}

      <div className="health-clinical-board" aria-label="Panorama de salud">
        <section className="health-care-lane is-attention">
          <header><span className="health-lane-icon"><IconoClinica /></span><div><small>Atención</small><h2>Necesitan revisión clínica</h2><p>Animales cuyo estado requiere seguimiento directo.</p></div></header>
          <div className="health-lane-metrics"><HealthMetric icono={IconoSalud} valor={enfermos?.length ?? '—'} etiqueta="Enfermos" detalle="Atención inmediata" tono="critical" /><HealthMetric icono={IconoOjo} valor={observacion?.length ?? '—'} etiqueta="En observación" detalle="Requieren seguimiento" tono="warning" /></div>
        </section>
        <section className="health-care-lane is-prevention">
          <header><span className="health-lane-icon"><IconoVacuna /></span><div><small>Prevención</small><h2>Cuidados programados</h2><p>Vacunas, revisiones y planes que ayudan a evitar problemas.</p></div></header>
          <div className="health-lane-metrics"><HealthMetric icono={IconoVacuna} valor={vacunas.length} etiqueta="Vacunas próximas" detalle="Siguientes 30 días" tono="preventive" /><HealthMetric icono={IconoCalendario} valor={revisiones.length} etiqueta="Revisiones" detalle="Próximas en agenda" tono="neutral" /><HealthMetric icono={IconoCampana} valor={resumen?.plan_sanitario_pendiente ?? '—'} etiqueta="Planes pendientes" detalle="Acción sanitaria" tono="plan" /></div>
        </section>
      </div>

      <EncabezadoDetalle titulo="¿Qué deseas consultar?" descripcion="La atención pendiente aparece primero; la actividad y los planes permanecen disponibles sin competir en la misma vista." paso="Detalle" />
      <div className="health-tabs"><SelectorDetalle
          valor={vista}
          onSeleccionar={setVista}
          opciones={[
            { id: 'atencion', etiqueta: 'Requiere atención', contador: vacunas.length + revisiones.length + (enfermos?.length || 0) + (observacion?.length || 0) },
            { id: 'actividad', etiqueta: 'Actividad reciente', contador: tratamientos.length },
            { id: 'planes', etiqueta: 'Planes sanitarios' },
          ]}
        /></div>

      {vista === 'atencion' && <div className="module-detail">
      <div className="guided-section-heading"><div><h2>Animales que necesitan revisión</h2><p>Los estados enfermo y en observación se muestran antes que el calendario preventivo.</p></div></div>
      <div className="health-attention-grid">
        <div>
          <div className="section-title">Animales enfermos</div>
          <div className="card" style={{ padding: '10px 0' }}>
            <ListaAnimales animales={enfermos} vacio="Sin animales enfermos" onAbrirSeguimiento={onAbrirSeguimiento} ultimoEventoPorAnimal={ultimoEventoPorAnimal} />
          </div>
        </div>
        <div>
          <div className="section-title">Animales en observación</div>
          <div className="card" style={{ padding: '10px 0' }}>
            <ListaAnimales animales={observacion} vacio="Sin animales en observación" onAbrirSeguimiento={onAbrirSeguimiento} ultimoEventoPorAnimal={ultimoEventoPorAnimal} />
          </div>
        </div>
      </div>

      <div className="guided-section-heading"><div><h2>Próximas acciones preventivas</h2><p>Vacunaciones y revisiones programadas para los siguientes 30 días.</p></div></div>
      <div className="health-attention-grid">
        <div>
          <div className="section-title">Vacunaciones próximas</div>
          <div className="card" style={{ padding: '10px 0' }}>
            <TablaEventos eventos={proximas === null ? null : vacunas} vacio="Sin vacunaciones próximas" onAbrirSeguimiento={onAbrirSeguimiento} />
          </div>
        </div>
        <div>
          <div className="section-title">Revisiones próximas</div>
          <div className="card" style={{ padding: '10px 0' }}>
            <TablaEventos eventos={proximas === null ? null : revisiones} vacio="Sin revisiones próximas" onAbrirSeguimiento={onAbrirSeguimiento} />
          </div>
        </div>
      </div>
      </div>}

      {vista === 'actividad' && <div className="module-detail">
      <div className="section-title">Tratamientos recientes</div>
      <div className="card" style={{ padding: '10px 0', marginBottom: 32 }}>
        <TablaEventos eventos={eventosSalud === null ? null : tratamientos} vacio="Sin tratamientos registrados" onAbrirSeguimiento={onAbrirSeguimiento} />
      </div>
      </div>}

      {vista === 'planes' && <div className="module-detail"><PlanesSanitarios integrado /></div>}
    </div>
  );
}

function HealthMetric({ icono: Icono, valor, etiqueta, detalle, tono }) {
  return (
    <div className={`health-metric tone-${tono}`}>
      <span className="health-metric-icon"><Icono /></span>
      <div><strong>{valor ?? '—'}</strong><span>{etiqueta}</span><small>{detalle}</small></div>
    </div>
  );
}
