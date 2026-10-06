import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import { estadoOperativoCorral, exigirListaModulo, ordenarCorrales, resumirCorrales } from '../monitoringUx.js';
import NuevoCorralModal from './NuevoCorralModal.jsx';
import EditarCorralModal from './EditarCorralModal.jsx';
import EstadoSaludBadge from './EstadoSaludBadge.jsx';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { PresentacionPantalla } from './PresentacionGuiada.jsx';
import { IconoAnimal, IconoCorral, IconoMovimiento, IconoOjo, IconoPersona, IconoSalud } from './Iconos.jsx';
import { mostrarExito } from '../feedbackOperacion.js';
import { actualizarContexto, crearRutaContextual, leerIdContexto } from '../navigationContext.js';
import ContextoNavegacion from './ContextoNavegacion.jsx';
import IndicadorDatosLocales from './IndicadorDatosLocales.jsx';
import { CONECTIVIDAD_OFFLINE, esFalloDeConectividad, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { ALMACEN_ANIMALES, ALMACEN_CORRALES, leerColeccionLocal } from '../offline/campoDB.js';
import { animalesDeCorralOffline } from '../offline/fichaOffline.js';

export default function CorralesList({ onAbrirSeguimiento }) {
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const navigate = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const corralContextoId = leerIdContexto(parametros, 'corral');
  const esAdmin = tienePermiso(usuario?.rol, 'corrales', 'crear');
  const [corrales, setCorrales] = useState([]);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [umbralLleno, setUmbralLleno] = useState(90);
  const [corralAbierto, setCorralAbierto] = useState(null);
  const [animalesCorral, setAnimalesCorral] = useState(null);
  const [errorDetalle, setErrorDetalle] = useState(null);
  const [fuenteLocal, setFuenteLocal] = useState(false);
  const [sincronizadoEn, setSincronizadoEn] = useState(null);

  async function cargar() {
    setCargando(true);
    setError(null);
    if (sinConexion && usuario?.id) {
      const local = await leerColeccionLocal(ALMACEN_CORRALES, usuario.id).catch(() => null);
      if (local) {
        setCorrales(local.datos);
        setSincronizadoEn(local.sincronizado_en);
        setFuenteLocal(true);
        setCargando(false);
        return;
      }
      setCorrales([]);
      setFuenteLocal(true);
      setError('No hay una copia local de Corrales. Conéctate a Internet para sincronizarla.');
      setCargando(false);
      return;
    }
    try {
      const data = await api.listarCorrales();
      setCorrales(exigirListaModulo(data, '/api/corrales'));
      setFuenteLocal(false);
    } catch (err) {
      if (esFalloDeConectividad(err) && usuario?.id) {
        const local = await leerColeccionLocal(ALMACEN_CORRALES, usuario.id).catch(() => null);
        if (local) {
          setCorrales(local.datos);
          setSincronizadoEn(local.sincronizado_en);
          setFuenteLocal(true);
          setCargando(false);
          return;
        }
      }
      setError(err.message);
    }
    setCargando(false);
  }

  useEffect(() => { cargar().catch(() => {}); }, [sinConexion, usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sinConexion) return;
    api.obtenerConfiguracion()
      .then((data) => {
        const item = data.find((configuracion) => configuracion.clave === 'pct_corral_casi_lleno');
        if (item) setUmbralLleno(Number(item.valor));
      })
      .catch(() => {});
  }, [sinConexion]);

  const corralesOrdenados = useMemo(() => ordenarCorrales(corrales, umbralLleno), [corrales, umbralLleno]);
  const resumen = useMemo(() => resumirCorrales(corrales, umbralLleno), [corrales, umbralLleno]);
  const ocupacionGeneral = resumen.capacidad > 0 ? Math.round((resumen.animales / resumen.capacidad) * 100) : 0;
  const corralContexto = useMemo(() => corrales.find((corral) => String(corral.id) === corralContextoId) || null, [corrales, corralContextoId]);

  async function abrirDetalle(corral) {
    setCorralAbierto(corral);
    setAnimalesCorral(null);
    setErrorDetalle(null);
    if (sinConexion && usuario?.id) {
      const local = await leerColeccionLocal(ALMACEN_ANIMALES, usuario.id).catch(() => null);
      setAnimalesCorral(animalesDeCorralOffline(local?.datos, corral.id));
      return;
    }
    try {
      const data = await api.listarAnimales({ estado: 'vivo', corral_id: corral.id });
      setAnimalesCorral(exigirListaModulo(data, `/api/animales?estado=vivo&corral_id=${corral.id}`));
    } catch (err) {
      if (esFalloDeConectividad(err) && usuario?.id) {
        const local = await leerColeccionLocal(ALMACEN_ANIMALES, usuario.id).catch(() => null);
        if (local) {
          setAnimalesCorral(animalesDeCorralOffline(local.datos, corral.id));
          return;
        }
      }
      setErrorDetalle(err.message);
    }
  }

  useEffect(() => {
    if (!cargando && corralContexto && String(corralAbierto?.id) !== String(corralContexto.id)) abrirDetalle(corralContexto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, corralContextoId, corralContexto]);

  function enfocarCorral(corral) {
    setParametros(actualizarContexto(parametros, { corral: corral.id }), { replace: true });
  }

  function quitarContexto() {
    setCorralAbierto(null);
    setParametros(actualizarContexto(parametros, { corral: null }), { replace: true });
  }

  return (
    <div className="monitoring-page corrales-page">
      <PresentacionPantalla
        etiqueta="Distribución del hato"
        titulo="Cómo están distribuidos los animales"
        descripcion="Revisa capacidad, ocupación y salud; los corrales que requieren atención aparecen primero."
        accion={esAdmin ? <button className="btn btn-primary" onClick={() => setMostrarModal(true)} disabled={sinConexion} title={sinConexion ? 'Conéctate para registrar corrales.' : undefined}>+ Registrar corral</button> : null}
        className="corral-module-header"
        icono={IconoCorral}
        acento="corral"
      />

      {fuenteLocal && <IndicadorDatosLocales sincronizadoEn={sincronizadoEn} />}
      {error && <EstadoError mensaje={error} onReintentar={cargar} />}
      {!cargando && corralContextoId && <ContextoNavegacion etiqueta={corralContexto?.nombre || `Corral ${corralContextoId}`} descripcion={corralContexto ? 'Se abrió el detalle del corral indicado por el enlace.' : 'El corral solicitado ya no está disponible; se muestran todos los corrales.'} invalido={!corralContexto} onLimpiar={quitarContexto} />}

      {cargando ? (
        <div className="card"><EstadoCarga mensaje="Cargando distribución de corrales…" /></div>
      ) : corrales.length === 0 ? (
        <div className="card"><EstadoVacio titulo="No hay corrales registrados todavía" descripcion="Registra el primer corral para comenzar a distribuir el hato." accion={esAdmin ? <button className="btn btn-primary" onClick={() => setMostrarModal(true)} disabled={sinConexion}>Registrar corral</button> : null} /></div>
      ) : <>
        <section className="monitoring-overview" aria-labelledby="corrales-panorama">
          <div className="monitoring-section-heading">
            <div><span className="guided-eyebrow">Panorama general</span><h2 id="corrales-panorama">Distribución y capacidad</h2></div>
          </div>
          <figure className="corral-landscape-band">
            <img src="/images/modules/corrales-panorama.jpg" alt="Vista panorámica de ganado distribuido en corrales de un rancho" loading="lazy" decoding="async" />
            <figcaption><span>Espacios físicos del rancho</span><strong>{resumen.corrales} corrales · {resumen.animales} animales ubicados</strong><small>La información operativa continúa debajo; la fotografía solo aporta contexto visual.</small></figcaption>
          </figure>
          <div className="corral-overview-card card">
            <div className="corral-overview-main">
              <span>Ocupación del rancho</span><strong>{resumen.animales} de {resumen.capacidad}</strong><small>{ocupacionGeneral}% de la capacidad registrada</small>
              <div className="ocupacion-bar ocupacion-bar-general" role="progressbar" aria-label={`Ocupación general: ${ocupacionGeneral}%`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={ocupacionGeneral}><div className="ocupacion-fill" style={{ width: `${Math.min(100, ocupacionGeneral)}%` }} /></div>
            </div>
            <div className="corral-overview-stats">
              <div><IconoCorral /><strong>{resumen.corrales}</strong><span>Corrales</span></div>
              <div className={resumen.alertas ? 'requiere-atencion' : ''}><IconoSalud /><strong>{resumen.alertas}</strong><span>Por atender</span></div>
              <div><IconoOjo /><strong>{resumen.observacion}</strong><span>Animales observados</span></div>
            </div>
            <div className="corral-layout-board">
              <div className="corral-layout-heading">
                <div><span>Vista de distribución</span><strong>Capacidad por corral</strong></div>
                <small>Esquema operativo; no representa la ubicación física.</small>
              </div>
              <div className="corral-layout-plots">
                {corralesOrdenados.map((corral) => {
                  const estado = estadoOperativoCorral(corral, umbralLleno);
                  const ocupacion = Number(corral.ocupacion_actual) || 0;
                  const capacidad = Number(corral.capacidad_maxima) || 0;
                  return (
                    <button type="button" key={corral.id} className={`corral-layout-plot estado-${estado.id}`} onClick={() => enfocarCorral(corral)} aria-label={`Abrir ${corral.nombre}: ${ocupacion} de ${capacidad} animales, ${estado.texto}`}>
                      <span><IconoCorral /><strong>{corral.nombre}</strong></span>
                      <small>{ocupacion} / {capacidad} animales</small>
                      <i aria-hidden="true"><b style={{ width: `${Math.min(100, estado.porcentaje)}%` }} /></i>
                      <em>{estado.texto}</em>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="monitoring-results" aria-labelledby="corrales-unidades">
          <div className="monitoring-section-heading">
            <div><span className="guided-eyebrow">Unidades de manejo</span><h2 id="corrales-unidades">Estado de cada corral</h2></div>
            <span className="monitoring-update-note">Prioridad operativa</span>
          </div>
          <div className="corral-grid corral-operational-grid">
            {corralesOrdenados.map((corral) => {
              const estado = estadoOperativoCorral(corral, umbralLleno);
              const ocupacion = Number(corral.ocupacion_actual) || 0;
              const capacidad = Number(corral.capacidad_maxima) || 0;
              return (
                <article className={`card corral-card corral-estado-${estado.id}`} key={corral.id}>
                  <div className="corral-card-top">
                    <span className="corral-card-icon" aria-hidden="true"><IconoCorral width={24} height={24} /></span>
                    <div><span className={`operational-badge estado-${estado.id}`}><span aria-hidden="true" />{estado.texto}</span><h3>{corral.nombre}</h3></div>
                    {esAdmin && <button className="btn btn-ghost corral-edit-action" onClick={() => setEditando(corral)} disabled={sinConexion} title={sinConexion ? 'Conéctate para editar corrales.' : undefined}>Editar</button>}
                  </div>

                  <div className="corral-capacity-line"><span>Ocupación{fuenteLocal && <em className="corral-dato-offline"> · última sincronización</em>}</span><strong>{capacidad > 0 ? `${ocupacion} / ${capacidad} animales` : `${ocupacion} animales`}</strong></div>
                  <div className="ocupacion-bar" role="progressbar" aria-label={`${corral.nombre}: ${Math.round(estado.porcentaje)}% de ocupación`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(estado.porcentaje)}><div className={`ocupacion-fill estado-${estado.id}`} style={{ width: `${estado.porcentaje}%` }} /></div>
                  <div className="corral-availability">{capacidad > 0 ? `${Math.max(0, capacidad - ocupacion)} espacios disponibles` : 'Capacidad no registrada'}</div>

                  <dl className="corral-health-grid">
                    <div><dt>Saludables</dt><dd>{corral.saludables || 0}</dd></div>
                    <div><dt>Observación</dt><dd>{corral.en_observacion || 0}</dd></div>
                    <div className={Number(corral.enfermos) > 0 ? 'alerta' : ''}><dt>Alertas</dt><dd>{corral.enfermos || 0}</dd></div>
                  </dl>

                  <div className="corral-card-context">
                    <span><IconoPersona aria-hidden="true" />{corral.responsable || 'Sin responsable asignado'}</span>
                    {corral.peso_promedio && <span>Peso promedio <strong>{corral.peso_promedio} kg</strong></span>}
                  </div>
                  <div className="corral-context-actions"><button type="button" className="btn btn-primary" onClick={() => navigate(crearRutaContextual('/animales', { corral: corral.id }))}><IconoAnimal width={17} height={17} /> Ver animales</button><button type="button" className="btn btn-ghost" onClick={() => navigate(crearRutaContextual('/movimientos', { corral: corral.id }))}><IconoMovimiento width={17} height={17} /> Movimientos</button><button type="button" className="btn btn-ghost" onClick={() => enfocarCorral(corral)}>Vista rápida</button></div>
                </article>
              );
            })}
          </div>
        </section>

        {corralAbierto && (
          <section className="card corral-detail-panel" aria-labelledby="corral-detalle-titulo">
            <div className="monitoring-section-heading">
              <div><span className="guided-eyebrow">{fuenteLocal ? 'Detalle del corral · última sincronización' : 'Detalle del corral'}</span><h2 id="corral-detalle-titulo">Animales en {corralAbierto.nombre}</h2></div>
              <button type="button" className="btn btn-ghost" onClick={quitarContexto}>Cerrar detalle</button>
            </div>
            {errorDetalle ? <EstadoError mensaje={errorDetalle} onReintentar={() => abrirDetalle(corralAbierto)} /> : !animalesCorral ? <EstadoCarga mensaje={`Cargando animales de ${corralAbierto.nombre}…`} /> : animalesCorral.length === 0 ? <EstadoVacio titulo="Este corral está vacío" descripcion="No hay animales vivos asignados actualmente." /> : (
              <div className="corral-animal-list">
                {animalesCorral.map((animal) => <button type="button" key={animal.id} className="corral-animal-row" onClick={() => onAbrirSeguimiento(animal.id)}><span className="corral-animal-avatar"><IconoAnimal aria-hidden="true" /></span><span><strong>{animal.nombre_alias || animal.arete_id}</strong><small>{animal.arete_id}{animal.ultimo_peso_kg ? ` · ${animal.ultimo_peso_kg} kg` : ' · Sin pesaje'}</small></span><EstadoSaludBadge estado={animal.estado} estadoSalud={animal.estado_salud} tamano="chico" /><span aria-hidden="true">→</span></button>)}
              </div>
            )}
          </section>
        )}
      </>}

      {mostrarModal && !sinConexion && <NuevoCorralModal onCerrar={() => setMostrarModal(false)} onCreado={async () => { setMostrarModal(false); await cargar(); mostrarExito({ titulo: 'Corral registrado correctamente' }); }} />}
      {editando && !sinConexion && <EditarCorralModal corral={editando} onCerrar={() => setEditando(null)} onGuardado={async () => { setEditando(null); await cargar(); mostrarExito({ titulo: 'Corral actualizado' }); }} />}
    </div>
  );
}
