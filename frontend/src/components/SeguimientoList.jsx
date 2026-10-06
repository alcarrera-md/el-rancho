import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import EstadoSaludBadge from './EstadoSaludBadge.jsx';
import { IconoAnimal, IconoBalanza, IconoCheck, IconoCorral, IconoLupa, IconoOjo, IconoSalud } from './Iconos.jsx';
import { PresentacionPantalla } from './PresentacionGuiada.jsx';
import { EstadoCarga, EstadoError, EstadoVacio, FeedbackOperacion } from './EstadosUI.jsx';
import AccionesRapidasAnimal from './AccionesRapidasAnimal.jsx';
import FlujoAccionAnimal from './FlujoAccionAnimal.jsx';
import { ACCIONES_CAMPO } from '../fieldActions.js';
import { exigirListaModulo, filtrarSeguimiento, nivelAtencionAnimal, resumirSeguimiento } from '../monitoringUx.js';
import ImagenAnimal from './ImagenAnimal.jsx';

export default function SeguimientoList({ onAbrirSeguimiento }) {
  const [animales, setAnimales] = useState(null);
  const [error, setError] = useState(null);
  const [consulta, setConsulta] = useState('');
  const [vista, setVista] = useState('todos');
  const [flujo, setFlujo] = useState(null);
  const [confirmacion, setConfirmacion] = useState('');

  function cargar() {
    setError(null);
    api.listarAnimales({ estado: 'vivo' })
      .then((data) => setAnimales(exigirListaModulo(data, '/api/animales?estado=vivo')))
      .catch((err) => setError(err.message));
  }

  useEffect(cargar, []);

  const resumen = useMemo(() => resumirSeguimiento(animales || []), [animales]);
  const resultados = useMemo(() => filtrarSeguimiento(animales || [], { consulta, vista }), [animales, consulta, vista]);
  const prioritarios = useMemo(() => filtrarSeguimiento(animales || [], { vista: 'alerta' })
    .concat(filtrarSeguimiento(animales || [], { vista: 'observacion' })).slice(0, 3), [animales]);

  function ejecutarAccion(animal, accion) {
    if (accion === ACCIONES_CAMPO.ABRIR) onAbrirSeguimiento(animal.id);
    else setFlujo({ animal, accion });
  }

  return (
    <div className="monitoring-page seguimiento-list-page">
      <PresentacionPantalla
        etiqueta="Supervisión del hato"
        titulo="Expedientes y evolución del hato"
        descripcion="Detecta quién necesita atención, registra trabajo de campo y entra al expediente completo."
      >
        {animales && <div className="monitoring-hero-mark" aria-hidden="true"><IconoAnimal width={46} height={46} /></div>}
      </PresentacionPantalla>

      {error && <EstadoError mensaje={error} onReintentar={cargar} />}
      <FeedbackOperacion mensaje={confirmacion} />

      {!animales ? (
        <div className="card">
          <EstadoCarga mensaje="Cargando animales en seguimiento…" />
        </div>
      ) : animales.length === 0 ? (
        <div className="card">
          <EstadoVacio titulo="No hay animales vivos registrados todavía" descripcion="Cuando registres animales, podrás abrir aquí su expediente completo." />
        </div>
      ) : <>
        <section className="monitoring-overview" aria-labelledby="seguimiento-panorama">
          <div className="monitoring-section-heading">
            <div><span className="guided-eyebrow">Panorama actual</span><h2 id="seguimiento-panorama">¿Dónde poner atención?</h2></div>
            <span className="monitoring-update-note">{resumen.total} animales vivos</span>
          </div>
          <div className="monitoring-summary-grid">
            <button type="button" className="monitoring-summary-card tono-rust" onClick={() => setVista('alerta')} aria-pressed={vista === 'alerta'}><IconoSalud /><strong>{resumen.alerta}</strong><span>Requieren atención</span></button>
            <button type="button" className="monitoring-summary-card tono-wheat" onClick={() => setVista('observacion')} aria-pressed={vista === 'observacion'}><IconoOjo /><strong>{resumen.observacion}</strong><span>En observación</span></button>
            <button type="button" className="monitoring-summary-card tono-pasture" onClick={() => setVista('estable')} aria-pressed={vista === 'estable'}><IconoCheck /><strong>{resumen.estable}</strong><span>Estables</span></button>
            <div className="monitoring-summary-card tono-earth"><IconoBalanza /><strong>{resumen.sinPesaje}</strong><span>Sin pesaje registrado</span></div>
          </div>
        </section>

        {prioritarios.length > 0 && (
          <section className="attention-panel" aria-labelledby="seguimiento-atencion">
            <div className="monitoring-section-heading">
              <div><span className="guided-eyebrow">Atención primero</span><h2 id="seguimiento-atencion">Animales para revisar</h2></div>
              <button type="button" className="btn btn-ghost" onClick={() => setVista(resumen.alerta ? 'alerta' : 'observacion')}>Ver todos</button>
            </div>
            <div className="attention-animal-list">
              {prioritarios.map((animal) => (
                <button type="button" key={animal.id} className={`attention-animal-row nivel-${nivelAtencionAnimal(animal)}`} onClick={() => onAbrirSeguimiento(animal.id)}>
                  <span className="attention-indicator" aria-hidden="true" />
                  <span><strong>{animal.nombre_alias || animal.arete_id}</strong><small>{animal.arete_id} · {animal.corral_actual || 'Sin corral'}</small></span>
                  <EstadoSaludBadge estado={animal.estado} estadoSalud={animal.estado_salud} tamano="chico" />
                  <span className="attention-open" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="monitoring-results" aria-labelledby="seguimiento-explorar">
          <div className="monitoring-section-heading">
            <div><span className="guided-eyebrow">Explorar el hato</span><h2 id="seguimiento-explorar">Animales y acciones</h2></div>
            <span className="monitoring-update-note">{resultados.length} resultados</span>
          </div>
          <div className="monitoring-toolbar">
            <label className="monitoring-search"><span className="sr-only">Buscar por arete, alias, raza o corral</span><IconoLupa aria-hidden="true" /><input className="input" type="search" inputMode="search" autoComplete="off" placeholder="Buscar arete, alias o corral…" value={consulta} onChange={(evento) => setConsulta(evento.target.value)} /></label>
            <div className="monitoring-filter-chips" role="group" aria-label="Filtrar animales por atención">
              {[['todos', 'Todos'], ['alerta', 'Atención'], ['observacion', 'Observación'], ['estable', 'Estables']].map(([id, etiqueta]) => <button type="button" key={id} className={vista === id ? 'activo' : ''} aria-pressed={vista === id} onClick={() => setVista(id)}>{etiqueta}</button>)}
            </div>
          </div>

          {resultados.length === 0 ? <div className="card"><EstadoVacio titulo="No encontramos animales con esos filtros" descripcion="Prueba otro arete, alias, corral o estado de atención." /></div> : (
            <div className="monitoring-animal-grid">
              {resultados.map((animal) => (
                <article key={animal.id} className={`monitoring-animal-card nivel-${nivelAtencionAnimal(animal)}`}>
                  <div className="monitoring-animal-identity">
                    <div className="monitoring-animal-photo">
                      <ImagenAnimal fotoUrl={animal.foto_url} fallback={<IconoAnimal width={30} height={30} aria-hidden="true" />} />
                    </div>
                    <div className="monitoring-animal-name"><span className="tag-badge">{animal.arete_id}</span><h3>{animal.nombre_alias || 'Sin alias'}</h3></div>
                    <EstadoSaludBadge estado={animal.estado} estadoSalud={animal.estado_salud} tamano="chico" />
                  </div>
                  <div className="monitoring-animal-facts">
                    <span><IconoCorral aria-hidden="true" />{animal.corral_actual || 'Sin corral asignado'}</span>
                    <span><IconoBalanza aria-hidden="true" />{animal.ultimo_peso_kg ? `${animal.ultimo_peso_kg} kg` : 'Sin pesaje'}</span>
                  </div>
                  <button type="button" className="btn btn-primary monitoring-primary-action" onClick={() => onAbrirSeguimiento(animal.id)}><IconoOjo width={17} height={17} /> Ver expediente</button>
                  <AccionesRapidasAnimal animal={animal} compacto onAccion={(accion) => ejecutarAccion(animal, accion)} />
                </article>
              ))}
            </div>
          )}
        </section>
      </>}

      {flujo && <FlujoAccionAnimal animal={flujo.animal} accion={flujo.accion} onCerrar={() => setFlujo(null)} onCompletado={(mensaje) => { setFlujo(null); setConfirmacion(mensaje); cargar(); }} />}
    </div>
  );
}
