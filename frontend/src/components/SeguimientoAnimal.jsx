import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { useModulos } from '../context/ModulosContext.jsx';
import { useFeedbackOperacion } from '../context/FeedbackOperacionContext.jsx';
import {
  IconoAnimal, IconoBalanza, IconoSalud, IconoHoja, IconoGota, IconoCheck, IconoCorazon,
  IconoSalir, IconoReportes, IconoLibro, IconoPersonas, IconoChat, IconoQR, IconoMovimiento,
} from './Iconos.jsx';
import RegistrarPesajeModal from './RegistrarPesajeModal.jsx';
import RegistrarSaludModal from './RegistrarSaludModal.jsx';
import RegistrarAlimentacionModal from './RegistrarAlimentacionModal.jsx';
import RegistrarLecheModal from './RegistrarLecheModal.jsx';
import RegistrarCondicionModal from './RegistrarCondicionModal.jsx';
import RegistrarMontaModal from './RegistrarMontaModal.jsx';
import RegistrarPartoModal from './RegistrarPartoModal.jsx';
import RegistrarDiagnosticoGestacionModal from './RegistrarDiagnosticoGestacionModal.jsx';
import TimelineReproductiva from './TimelineReproductiva.jsx';
import BajaAnimalModal from './BajaAnimalModal.jsx';
import EditarAnimalModal from './EditarAnimalModal.jsx';
import CambiarEstadoSaludModal from './CambiarEstadoSaludModal.jsx';
import CambiarCategoriaModal from './CambiarCategoriaModal.jsx';
import AsignarPlanAnimalModal from './AsignarPlanAnimalModal.jsx';
import RecomendacionesPanel from './RecomendacionesPanel.jsx';
import ArbolGenealogico from './ArbolGenealogico.jsx';
import ResumenIAModal from './ResumenIAModal.jsx';
import CodigoQRModal from './CodigoQRModal.jsx';
import DiarioNotas from './DiarioNotas.jsx';
import CurvaPeso from './CurvaPeso.jsx';
import CurvaLeche from './CurvaLeche.jsx';
import AccionesRapidasAnimal from './AccionesRapidasAnimal.jsx';
import MoverAnimalModal from './MoverAnimalModal.jsx';
import NotaRapidaModal from './NotaRapidaModal.jsx';
import { exportarFichaPDF } from '../exportUtils.js';
import { tienePermiso } from '../authorization/permissions.js';
import { ACCIONES_CAMPO, MENSAJES_ACCION } from '../fieldActions.js';
import { construirAtencionAnimal } from '../guidedUx.js';
import { esAnimalNoEncontrado } from '../routing.js';
import { EstadoCarga, EstadoError, FeedbackOperacion } from './EstadosUI.jsx';
import ImagenAnimal from './ImagenAnimal.jsx';
import PaisajeGanadero from './PaisajeGanadero.jsx';
import ModuleHeader from './ModuleHeader.jsx';
import { normalizarExpedienteAnimal } from '../seguimientoData.js';
import { detalleMovimientoConfirmado } from '../feedbackOperacion.js';
import { actualizarContexto, seccionSeguimientoValida } from '../navigationContext.js';
import { accionParaEstado } from '../reproduccionUx.js';

const ETIQUETAS_TIPO = {
  pesaje: 'Pesaje', salud: 'Evento de salud', alimentacion: 'Alimentación', reproduccion: 'Evento reproductivo',
  movimiento: 'Movimiento de corral', leche: 'Producción de leche', condicion: 'Condición corporal', categoria: 'Cambio de categoría',
};
const CATEGORIA_LABEL = { cria: 'Cría', destete: 'Destete', engorde: 'Engorde', vientre: 'Vientre', reproductor: 'Reproductor', descarte: 'Descarte' };
const TIPOS_EDITABLES = ['pesaje', 'salud', 'alimentacion', 'leche', 'condicion'];
const ESTADO_SALUD_LABEL = { sano: 'Sano', observacion: 'En observación', enfermo: 'Enfermo' };
const TIPOS_TRATAMIENTO = ['tratamiento', 'desparasitacion'];

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function DetalleEvento({ tipo, detalle, onRegistrarParto, puedeRegistrarParto, onEditar, puedeEditar }) {
  const contenido = (() => {
    switch (tipo) {
      case 'pesaje':
        return <>Peso registrado: <strong>{detalle.peso_kg} kg</strong>{detalle.observacion ? ` — ${detalle.observacion}` : ''}</>;
      case 'salud':
        return <>{detalle.tipo}{detalle.enfermedad ? ` — ${detalle.enfermedad}` : ''}{detalle.proxima_dosis ? ` (próxima dosis: ${formatearFecha(detalle.proxima_dosis)})` : ''}</>;
      case 'alimentacion':
        return <>{detalle.cantidad} {detalle.unidad_medida} de {detalle.insumo}</>;
      case 'leche':
        return <>{detalle.litros} L {detalle.turno !== 'unico' ? `(turno ${detalle.turno === 'manana' ? 'mañana' : 'tarde'})` : ''}{detalle.observacion ? ` — ${detalle.observacion}` : ''}</>;
      case 'condicion':
        return <>Condición corporal: <strong>{detalle.puntuacion}/5</strong>{detalle.observacion ? ` — ${detalle.observacion}` : ''}</>;
      case 'categoria':
        return <>{detalle.categoria_anterior ? `De "${CATEGORIA_LABEL[detalle.categoria_anterior] || detalle.categoria_anterior}" a` : 'Asignada a'} "{CATEGORIA_LABEL[detalle.categoria_nueva] || detalle.categoria_nueva}"{detalle.motivo ? ` — ${detalle.motivo}` : ''}</>;
      case 'movimiento':
        return <>{detalle.corral_origen ? `De ${detalle.corral_origen} a` : 'Ingresó a'} {detalle.corral_destino}{detalle.motivo ? ` (${detalle.motivo})` : ''}</>;
      case 'reproduccion':
        return (
          <>
            Monta {detalle.tipo_monta === 'natural' ? 'natural' : 'por inseminación artificial'}
            {detalle.fecha_parto_real ? ` — parto el ${formatearFecha(detalle.fecha_parto_real)} (${detalle.resultado})` : ` — parto estimado: ${formatearFecha(detalle.fecha_parto_estimada)}`}
            {!detalle.fecha_parto_real && puedeRegistrarParto && (
              <> <button className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: '0.78rem' }} onClick={() => onRegistrarParto(detalle.id)}>Registrar parto</button></>
            )}
          </>
        );
      default: return null;
    }
  })();
  return (
    <>
      {contenido}
      {puedeEditar && TIPOS_EDITABLES.includes(tipo) && (
        <> <button className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: '0.78rem' }} onClick={() => onEditar(tipo, detalle)}>Editar</button></>
      )}
    </>
  );
}

function ListaEventos({ eventos, vacio, puedeEditar, ...props }) {
  if (eventos.length === 0) {
    return <div className="empty-state"><h3 style={{ fontSize: '0.95rem' }}>{vacio}</h3></div>;
  }
  return (
    <div className="bitacora">
      {eventos.map((evento, i) => (
        <div key={i} className={`bitacora-item tipo-${evento.tipo}`}>
          <div className="bitacora-fecha">{formatearFecha(evento.fecha)}</div>
          <div className="bitacora-titulo">{ETIQUETAS_TIPO[evento.tipo]}</div>
          <div className="bitacora-detalle">
            <DetalleEvento
              tipo={evento.tipo}
              detalle={evento.detalle}
              puedeEditar={typeof puedeEditar === 'function' ? puedeEditar(evento.tipo) : puedeEditar}
              {...props}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniCurvaPeso({ eventos }) {
  const puntosPeso = eventos.slice().reverse().slice(-8).map((evento) => Number(evento.detalle?.peso_kg)).filter(Number.isFinite);
  if (puntosPeso.length < 2) return <div className="seg-mini-chart-empty"><IconoBalanza /><span>Registra al menos dos pesajes para ver la evolución.</span></div>;
  const minimo = Math.min(...puntosPeso);
  const rango = Math.max(Math.max(...puntosPeso) - minimo, 1);
  const puntos = puntosPeso.map((peso, indice) => `${(indice / (puntosPeso.length - 1)) * 100},${46 - ((peso - minimo) / rango) * 35}`).join(' ');
  return <div className="seg-mini-chart"><svg viewBox="0 0 100 52" role="img" aria-label="Evolución de los últimos pesajes" preserveAspectRatio="none"><defs><linearGradient id="segWeightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".25" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs><polygon points={`0,52 ${puntos} 100,52`} fill="url(#segWeightFill)" /><polyline points={puntos} fill="none" stroke="currentColor" strokeWidth="2.4" vectorEffect="non-scaling-stroke" /></svg><span>Últimos {puntosPeso.length} pesajes</span></div>;
}

export default function SeguimientoAnimal({ animalId, onVolver, onVolverReproduccion, onCambiarAnimal }) {
  const { mostrarExito, mostrarError } = useFeedbackOperacion();
  const { usuario } = useAuth();
  const { activo } = useModulos() || {};
  const [parametros, setParametros] = useSearchParams();
  const puedeMonta = tienePermiso(usuario?.rol, 'reproduccion', 'crear');
  const puedeSalud = tienePermiso(usuario?.rol, 'salud', 'crear');
  const puedeAlimentacion = tienePermiso(usuario?.rol, 'alimentacion', 'crear');
  const puedePesaje = tienePermiso(usuario?.rol, 'pesajes', 'crear');
  const puedeLeche = tienePermiso(usuario?.rol, 'produccion_leche', 'crear');
  const puedeCondicion = tienePermiso(usuario?.rol, 'condicion_corporal', 'crear');
  const puedeCategoria = tienePermiso(usuario?.rol, 'animales', 'editar');
  const puedeEstadoClinico = tienePermiso(usuario?.rol, 'animales', 'estado_clinico');
  const puedeReportarObservacion = tienePermiso(usuario?.rol, 'animales', 'reportar_observacion');
  const puedeEstadoSalud = puedeEstadoClinico || puedeReportarObservacion;
  const puedeBaja = tienePermiso(usuario?.rol, 'animales', 'baja');
  const puedeEditarAnimal = tienePermiso(usuario?.rol, 'animales', 'editar');
  const puedeAsignarPlan = tienePermiso(usuario?.rol, 'planes_sanitarios', 'asignar');
  const puedeResumenIA = tienePermiso(usuario?.rol, 'asistente', 'resumen');
  const puedeNota = tienePermiso(usuario?.rol, 'notas_seguimiento', 'crear');

  const PERMISO_POR_TIPO = { pesaje: puedePesaje, salud: puedeSalud, alimentacion: puedeAlimentacion, leche: puedeLeche, condicion: puedeCondicion };

  const [data, setData] = useState(null);
  const [cicloReproductivo, setCicloReproductivo] = useState(null);
  const [historialReproductivo, setHistorialReproductivo] = useState({ ciclos: [], legado_no_clasificado: [] });
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(() => seccionSeguimientoValida(parametros.get('seccion')));
  const [modalActivo, setModalActivo] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [aplicandoItem, setAplicandoItem] = useState(null);
  const [errorOperacion, setErrorOperacion] = useState('');

  async function cargar() {
    const [expediente, ciclo, historialCiclos] = await Promise.all([
      api.obtenerHistorial(animalId).then(normalizarExpedienteAnimal),
      api.obtenerCicloReproductivoActual(animalId),
      api.obtenerHistorialReproductivo(animalId),
    ]);
    setData(expediente);
    setCicloReproductivo(ciclo);
    setHistorialReproductivo(historialCiclos);
    return expediente;
  }

  useEffect(() => {
    setData(null);
    setCicloReproductivo(null);
    setHistorialReproductivo({ ciclos: [], legado_no_clasificado: [] });
    setError(null);
    setTab(seccionSeguimientoValida(parametros.get('seccion')));
    cargar().catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animalId]);

  useEffect(() => {
    const seccion = seccionSeguimientoValida(parametros.get('seccion'));
    if (seccion !== tab) setTab(seccion);
  }, [parametros, tab]);

  function cambiarTab(seccion) {
    setTab(seccion);
    setParametros(actualizarContexto(parametros, { seccion: seccion === 'info' ? null : seccion }));
  }

  async function cerrarYRecargar(mensaje = 'Registro guardado correctamente.', resultado) {
    setModalActivo(null);
    setErrorOperacion('');
    try {
      await cargar();
      mostrarExito(resultado?.movimiento
        ? detalleMovimientoConfirmado(resultado.animal || data?.animal, resultado.movimiento)
        : { titulo: mensaje });
    } catch (errorCarga) {
      setErrorOperacion(`La operación fue confirmada, pero no se pudo actualizar la ficha: ${errorCarga.message}`);
    }
  }
  async function cerrarAlimentacion(resultado) {
    if (resultado?.offline_pending) {
      setModalActivo(null);
      setErrorOperacion('');
      mostrarExito({
        titulo: 'Guardado en este dispositivo',
        mensaje: 'Pendiente de sincronización.',
      });
      return;
    }
    await cerrarYRecargar(MENSAJES_ACCION.alimentacion, resultado);
  }
  async function cerrarMovimiento(resultado) {
    if (resultado?.offline_pending) {
      setModalActivo(null);
      setErrorOperacion('');
      mostrarExito({
        titulo: 'Guardado en este dispositivo',
        mensaje: 'Pendiente de sincronización.',
      });
      return;
    }
    await cerrarYRecargar(MENSAJES_ACCION.mover, resultado);
  }
  function manejarAnimalReproductivoNoDisponible() {
    setModalActivo(null);
    mostrarError({ titulo: 'El estado reproductivo cambió', mensaje: 'Este animal ya no está disponible para acciones reproductivas ni para esta acción. Actualizamos la información.' });
    onVolverReproduccion?.();
  }
  async function cerrarEdicionYRecargar(mensaje = 'Registro actualizado correctamente.') {
    setEdicion(null);
    try {
      await cargar();
      mostrarExito({ titulo: mensaje });
    } catch (errorCarga) {
      setErrorOperacion(`La operación fue confirmada, pero no se pudo actualizar la ficha: ${errorCarga.message}`);
    }
  }
  function manejarEditar(tipo, detalle) {
    if (!PERMISO_POR_TIPO[tipo]) return;
    setEdicion({ tipo, registro: detalle });
  }

  function abrirAccionRapida(accion) {
    const modalPorAccion = {
      [ACCIONES_CAMPO.PESAJE]: 'pesaje',
      [ACCIONES_CAMPO.ALIMENTACION]: 'alimentacion',
      [ACCIONES_CAMPO.OBSERVACION]: 'observacion-rapida',
      [ACCIONES_CAMPO.SALUD]: 'salud-rapida',
      [ACCIONES_CAMPO.MOVER]: 'mover-rapido',
      [ACCIONES_CAMPO.LECHE]: 'leche',
      [ACCIONES_CAMPO.NOTA]: 'nota-rapida',
    };
    if (modalPorAccion[accion]) setModalActivo(modalPorAccion[accion]);
  }

  useEffect(() => {
    if (!data?.animal) return;
    const accion = parametros.get('accion');
    const accionReproductivaSolicitada = ['servicio', 'diagnostico', 'parto'].includes(accion);
    if (accionReproductivaSolicitada && data.animal.estado !== 'vivo') {
      manejarAnimalReproductivoNoDisponible();
      return;
    }
    const permitida = (accion === ACCIONES_CAMPO.PESAJE && puedePesaje)
      || (accion === ACCIONES_CAMPO.NOTA && puedeNota)
      || (accion === ACCIONES_CAMPO.OBSERVACION && puedeReportarObservacion)
      || (accion === ACCIONES_CAMPO.ALIMENTACION && puedeAlimentacion)
      || (accion === 'servicio' && puedeMonta)
      || (accion === 'diagnostico' && puedeMonta && cicloReproductivo?.id && !cicloReproductivo.fecha_cierre)
      || (accion === 'parto' && puedeMonta && cicloReproductivo?.id && ['prenada', 'proxima_parto'].includes(cicloReproductivo?.estado_actual?.codigo));
    if (!permitida) return;
    if (accion === 'servicio') setModalActivo('monta');
    else if (accion === 'diagnostico') setModalActivo('diagnostico-gestacion');
    else if (accion === 'parto') setModalActivo('parto-v2');
    else abrirAccionRapida(accion);
    setParametros(actualizarContexto(parametros, { accion: null }), { replace: true });
  }, [data?.animal?.id, cicloReproductivo?.id, parametros]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportarFicha(animal, timeline) {
    setErrorOperacion('');
    try {
      await exportarFichaPDF(animal, timeline);
    } catch (err) {
      setErrorOperacion(`No se pudo preparar el PDF: ${err.message}`);
    }
  }

  if (error && esAnimalNoEncontrado(error)) return (
    <div className="seguimiento-shell"><div className="seguimiento-contenido">
      <div className="card route-state" role="alert">
        <div className="route-state-code">404</div><h1>Animal no encontrado</h1>
        <p>El animal solicitado no existe o ya no está disponible.</p>
        <button className="btn btn-primary" onClick={onVolver}>Ver animales</button>
      </div>
    </div></div>
  );
  if (error) return <div className="seguimiento-shell"><div className="seguimiento-contenido"><EstadoError mensaje={error.message} onReintentar={cargar} /></div></div>;
  if (!data) return <div className="seguimiento-shell"><div className="seguimiento-contenido"><EstadoCarga mensaje="Cargando expediente del animal…" /></div></div>;

  const { animal, resumen, resumen_leche, recomendaciones, timeline, crias, venta, compra, notas, plan_sanitario, rentabilidad } = data;
  const pendientesPlan = plan_sanitario.filter((p) => p.estado !== 'aplicado').length;
  const atencionAnimal = construirAtencionAnimal({ animal, recomendaciones, pendientesPlan });

  const eventosSalud = timeline.filter((e) => e.tipo === 'salud');
  const eventosVacunas = eventosSalud.filter((e) => e.detalle.tipo === 'vacuna');
  const eventosTratamientos = eventosSalud.filter((e) => TIPOS_TRATAMIENTO.includes(e.detalle.tipo));
  const eventosDiagnosticos = eventosSalud.filter((e) => e.detalle.tipo === 'diagnostico');
  const eventosCondicion = timeline.filter((e) => e.tipo === 'condicion');
  const eventosPesaje = timeline.filter((e) => e.tipo === 'pesaje');
  const eventosReproduccion = timeline.filter((e) => e.tipo === 'reproduccion');
  const eventosLeche = timeline.filter((e) => e.tipo === 'leche');
  const eventosAlimentacion = timeline.filter((e) => e.tipo === 'alimentacion');
  const eventosMovimiento = timeline.filter((e) => e.tipo === 'movimiento');

  const TABS = [
    { id: 'info', label: 'Panorama', icono: IconoReportes },
    { id: 'salud', label: 'Salud', icono: IconoSalud, badge: pendientesPlan },
    { id: 'alimentacion', label: 'Alimentación', icono: IconoHoja },
    { id: 'pesajes', label: 'Pesajes', icono: IconoBalanza },
    { id: 'movimientos', label: 'Movimientos', icono: IconoMovimiento },
    { id: 'reproduccion', label: 'Reproducción', icono: IconoCorazon },
    { id: 'notas', label: 'Notas', icono: IconoChat, badge: notas.length },
    { id: 'historial', label: 'Historial', icono: IconoLibro },
    { id: 'vacunaciones', label: 'Vacunas', icono: IconoGota },
    { id: 'tratamientos', label: 'Tratamientos', icono: IconoCheck },
    { id: 'genealogia', label: 'Genealogía', icono: IconoPersonas, moduloClave: 'genealogia' },
  ].filter((t) => !t.moduloClave || !activo || activo(t.moduloClave));

  const ultimaCondicion = eventosCondicion[0]?.detalle?.puntuacion;
  const estadoReproductivo = cicloReproductivo?.estado_actual?.codigo || 'disponible';
  const accionReproductiva = accionParaEstado(estadoReproductivo);
  const modalAccionReproductiva = { servicio: 'monta', diagnostico: 'diagnostico-gestacion', parto: 'parto-v2' }[accionReproductiva.id];

  return (
    <div className="seguimiento-shell">
      <div className="seguimiento-contenido">
        <ModuleHeader
          eyebrow="Seguimiento animal"
          title="Expediente y evolución del animal"
          description="Salud, producción y eventos importantes en un solo lugar."
          icon={IconoAnimal}
          accent="animal"
          variant="compact"
          action={<details className="seg-header-menu"><summary aria-label="Opciones del expediente">•••</summary><div>{puedeEditarAnimal && <button onClick={() => setModalActivo('editar-animal')}>Editar datos</button>}<button onClick={() => exportarFicha(animal, timeline)}>Exportar PDF</button>{puedeResumenIA && (!activo || activo('ia')) && <button onClick={() => setModalActivo('resumen-ia')}>Resumen con IA</button>}<button onClick={() => setModalActivo('qr')}>Ver código QR</button></div></details>}
        />

        <section className="seg-animal-dashboard" aria-labelledby="seg-animal-titulo">
          <article className="seg-animal-profile">
            <div className="seg-profile-land"><PaisajeGanadero compacto /></div>
            <div className="seg-profile-orbit"><ImagenAnimal fotoUrl={animal.foto_url} alt={animal.nombre_alias || animal.arete_id} className="seg-foto" fallback={<div className="seg-foto-placeholder" role="img" aria-label={`Sin foto de ${animal.nombre_alias || animal.arete_id}`}><IconoAnimal width={38} height={38} aria-hidden="true" /></div>} /></div>
            <div className="seg-identidad"><span>Animal en seguimiento · {animal.sexo === 'hembra' ? 'Hembra' : 'Macho'}</span><h2 id="seg-animal-titulo" className="seg-nombre">{animal.nombre_alias || 'Sin alias'}</h2><p>{animal.raza || 'Raza sin especificar'}</p><div className="seg-arete"><span>Arete</span><strong>{animal.arete_id}</strong></div><div className="seg-profile-chips"><span>{CATEGORIA_LABEL[animal.categoria] || 'Sin categoría'}</span><span className={`health-${animal.estado_salud}`}>{ESTADO_SALUD_LABEL[animal.estado_salud] || animal.estado_salud}</span></div></div>
            <div className="seg-profile-stamp"><span>Expediente</span><strong>{timeline.length}</strong><small>registros</small></div>
          </article>

          <dl className="seg-metric-grid">
            <div className="metric-weight"><span><IconoBalanza /></span><dt>Último peso</dt><dd>{resumen.ultimo_peso ? `${resumen.ultimo_peso.peso_kg} kg` : '—'}</dd><small>{resumen.total_pesajes} registro(s)</small></div>
            <div className="metric-health"><span><IconoSalud /></span><dt>Salud</dt><dd>{ESTADO_SALUD_LABEL[animal.estado_salud] || animal.estado_salud}</dd>{puedeEstadoSalud && <button onClick={() => setModalActivo('estado-salud')}>Actualizar</button>}</div>
            <div className="metric-condition"><span><IconoCheck /></span><dt>Condición</dt><dd>{ultimaCondicion ? `${ultimaCondicion}/5` : '—'}</dd><small>{ultimaCondicion ? 'Última evaluación' : 'Sin registro'}</small></div>
            <div className="metric-corral"><span><IconoMovimiento /></span><dt>Corral</dt><dd>{animal.corral_actual || 'Sin corral'}</dd><small>{eventosMovimiento.length} movimiento(s)</small></div>
          </dl>

          <article className={`seg-status-card status-${atencionAnimal.tono}`} role="status"><div className="seg-status-copy"><span>Estado actual</span><h2>{atencionAnimal.titulo}</h2><p>{atencionAnimal.avisos[0] || 'No hay avisos prioritarios con la información registrada.'}</p><div className="seg-status-actions">{puedeEstadoSalud && <button onClick={() => setModalActivo('estado-salud')}>Revisar salud</button>}{puedeNota && <button onClick={() => setModalActivo('nota-rapida')}>Añadir nota</button>}</div></div><div className="seg-weight-visual"><strong>{resumen.ultimo_peso ? `${resumen.ultimo_peso.peso_kg}` : '—'}<small>kg</small></strong><MiniCurvaPeso eventos={eventosPesaje} /></div></article>

          <article className="seg-quick-panel"><div><span>Acciones rápidas</span><h2>Registrar ahora</h2><p>El animal ya está seleccionado.</p></div><AccionesRapidasAnimal animal={animal} onAccion={abrirAccionRapida} /></article>
        </section>

        <FeedbackOperacion tipo="error" mensaje={errorOperacion} />

        {venta && (
          <div className="error-banner" style={{ background: 'var(--wheat-soft)', color: '#6b4f10', borderColor: 'var(--wheat)' }}>
            Vendido el {formatearFecha(venta.fecha)} a {venta.comprador} por ${venta.precio}
          </div>
        )}

        <div className="seg-content-heading"><div><span>Expediente</span><h2>Historia y registros</h2></div>{compra && <p>Origen: comprado a {compra.proveedor} · {formatearFecha(compra.fecha)}</p>}</div>

        <div className="seg-tabs seg-product-tabs" role="tablist" aria-label="Secciones del expediente">
          {TABS.map((t) => {
            const Icono = t.icono;
            return (
              <button key={t.id} role="tab" data-tab={t.id} aria-selected={tab === t.id} className={`seg-tab ${tab === t.id ? 'activo' : ''}`} onClick={() => cambiarTab(t.id)}>
                <Icono width={15} height={15} />
                {t.label}
                {t.badge > 0 && <span className="seg-tab-badge">{t.badge}</span>}
              </button>
            );
          })}
        </div>

        {tab === 'info' && (
          <>
            <RecomendacionesPanel recomendaciones={recomendaciones} />

            <div className="resumen-grid">
              <div className="card resumen-item">
                <div className="valor">{resumen.total_pesajes}</div>
                <div className="etiqueta">Pesajes</div>
              </div>
              <div className="card resumen-item">
                <div className="valor">{resumen.total_eventos_salud}</div>
                <div className="etiqueta">Eventos de salud</div>
              </div>
              <div className="card resumen-item">
                <div className="valor">{resumen.total_eventos_reproductivos}</div>
                <div className="etiqueta">Reproducción</div>
              </div>
              <div className="card resumen-item">
                <div className="valor">{resumen.ultimo_peso ? `${resumen.ultimo_peso.peso_kg} kg` : '—'}</div>
                <div className="etiqueta">Último peso</div>
              </div>
              <div className="card resumen-item">
                <div className="valor">{crias.length}</div>
                <div className="etiqueta">Crías</div>
              </div>
            </div>

            {rentabilidad && (rentabilidad.costo_total > 0 || rentabilidad.ingreso_total > 0) && (
              <div className="card" style={{ padding: '20px 24px', marginBottom: 24 }}>
                <div className="section-title">Rentabilidad estimada</div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>Costo total</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem' }}>${rentabilidad.costo_total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>Ingreso total</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem' }}>${rentabilidad.ingreso_total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>Neto</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', fontWeight: 700, color: rentabilidad.neto >= 0 ? 'var(--pasture)' : 'var(--rust)' }}>
                      ${rentabilidad.neto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {animal.estado === 'vivo' && puedeBaja && (
              <div className="card" style={{ padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.88rem', color: 'var(--ink-soft)' }}>Venta, muerte o sacrificio de este animal</span>
                <button className="btn btn-ghost" style={{ color: 'var(--rust)' }} onClick={() => setModalActivo('baja')}>
                  <IconoSalir width={16} height={16} /> Dar de baja
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'salud' && (
          <>
            {animal.estado === 'vivo' && (puedeSalud || puedeCondicion) && (
              <div className="seg-tab-acciones">
                {puedeSalud && <button className="btn btn-ghost" onClick={() => setModalActivo('salud-diagnostico')}>+ Registrar diagnóstico</button>}
                {puedeCondicion && <button className="btn btn-ghost" onClick={() => setModalActivo('condicion')}>+ Registrar condición corporal</button>}
              </div>
            )}

            <div className="card" style={{ padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div className="section-title" style={{ marginBottom: 0 }}>Plan sanitario</div>
                {puedeAsignarPlan && animal.estado === 'vivo' && (
                  <button className="btn btn-ghost" onClick={() => setModalActivo('asignar-plan')}>+ Asignar plan</button>
                )}
              </div>
              {plan_sanitario.length === 0 ? (
                <div className="empty-state"><h3 style={{ fontSize: '0.95rem' }}>Este animal no tiene ningún plan sanitario asignado</h3></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {plan_sanitario.map((item) => {
                    const colorEstado = item.estado === 'vencido' ? 'var(--rust)' : item.estado === 'aplicado' ? 'var(--pasture)' : 'var(--wheat)';
                    const etiquetaEstado = item.estado === 'vencido' ? 'Vencido' : item.estado === 'aplicado' ? 'Aplicado' : 'Próximo';
                    return (
                      <div key={item.item_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--paper)', borderRadius: 8, borderLeft: `3px solid ${colorEstado}` }}>
                        <div>
                          <strong style={{ fontSize: '0.9rem' }}>{item.nombre_evento}</strong>
                          <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
                            {item.plan_nombre} — {formatearFecha(item.fecha_objetivo)} — <span style={{ color: colorEstado, fontWeight: 600 }}>{etiquetaEstado}</span>
                          </div>
                        </div>
                        {item.estado !== 'aplicado' && puedeSalud && (
                          <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => setAplicandoItem(item)}>Aplicar ahora</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: '20px 24px', marginBottom: 24 }}>
              <div className="section-title">Diagnósticos y revisiones</div>
              <ListaEventos
                eventos={eventosDiagnosticos}
                vacio="Sin diagnósticos registrados"
                onEditar={manejarEditar} puedeEditar={puedeSalud}
              />
            </div>

            <div className="card" style={{ padding: '20px 24px' }}>
              <div className="section-title">Condición corporal</div>
              <ListaEventos
                eventos={eventosCondicion}
                vacio="Sin registros de condición corporal"
                onEditar={manejarEditar} puedeEditar={puedeCondicion}
              />
            </div>
          </>
        )}

        {tab === 'vacunaciones' && (
          <div className="card" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Vacunaciones</div>
              {animal.estado === 'vivo' && puedeSalud && (
                <button className="btn btn-ghost" onClick={() => setModalActivo('salud-vacuna')}>+ Registrar vacunación</button>
              )}
            </div>
            <ListaEventos
              eventos={eventosVacunas}
              vacio="Sin vacunaciones registradas"
              onEditar={manejarEditar} puedeEditar={puedeSalud}
            />
          </div>
        )}

        {tab === 'tratamientos' && (
          <div className="card" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Tratamientos</div>
              {animal.estado === 'vivo' && puedeSalud && (
                <button className="btn btn-ghost" onClick={() => setModalActivo('salud-tratamiento')}>+ Registrar tratamiento</button>
              )}
            </div>
            <ListaEventos
              eventos={eventosTratamientos}
              vacio="Sin tratamientos registrados"
              onEditar={manejarEditar} puedeEditar={puedeSalud}
            />
          </div>
        )}

        {tab === 'pesajes' && (
          <>
            {animal.estado === 'vivo' && puedePesaje && (
              <div className="seg-tab-acciones">
                <button className="btn btn-ghost" onClick={() => setModalActivo('pesaje')}>+ Registrar pesaje</button>
              </div>
            )}
            <CurvaPeso pesajes={eventosPesaje.map((e) => e.detalle)} />
            <div className="card" style={{ padding: '20px 24px' }}>
              <div className="section-title">Historial de pesajes</div>
              <ListaEventos
                eventos={eventosPesaje}
                vacio="Sin pesajes registrados"
                onEditar={manejarEditar} puedeEditar={puedePesaje}
              />
            </div>
          </>
        )}

        {tab === 'reproduccion' && (
          <>
            {animal.estado === 'vivo' && animal.sexo === 'hembra' && (
              <div className="repro-animal-action card">
                <div><span>Estado actual</span><h2>{cicloReproductivo?.estado_actual?.etiqueta || 'Disponible'}</h2><p>{accionReproductiva.id === 'seguimiento' ? 'El ciclo está cerrado. Consulta su historia antes de iniciar un nuevo manejo.' : `Siguiente paso recomendado: ${accionReproductiva.etiqueta.toLowerCase()}.`}</p></div>
                {puedeMonta && modalAccionReproductiva && <button className="btn btn-primary" onClick={() => setModalActivo(modalAccionReproductiva)}>{accionReproductiva.etiqueta}</button>}
              </div>
            )}

            <section className="repro-animal-history card">
              <div className="section-title">Historia reproductiva por ciclo</div>
              <TimelineReproductiva ciclos={historialReproductivo.ciclos} legado={historialReproductivo.legado_no_clasificado} />
            </section>

            {animal.sexo === 'hembra' && <CurvaLeche registros={eventosLeche.map((e) => e.detalle)} />}

            {animal.sexo === 'hembra' && (
              <div className="card" style={{ padding: '20px 24px' }}>
                <div className="section-title">Producción de leche</div>
                <ListaEventos
                  eventos={eventosLeche}
                  vacio="Sin registros de leche"
                  onEditar={manejarEditar} puedeEditar={puedeLeche}
                />
              </div>
            )}
          </>
        )}

        {tab === 'alimentacion' && (
          <div className="card" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Alimentación</div>
              {animal.estado === 'vivo' && puedeAlimentacion && (
                <button className="btn btn-ghost" onClick={() => setModalActivo('alimentacion')}>+ Registrar alimentación</button>
              )}
            </div>
            <ListaEventos
              eventos={eventosAlimentacion}
              vacio="Sin registros de alimentación"
              onEditar={manejarEditar} puedeEditar={puedeAlimentacion}
            />
          </div>
        )}

        {tab === 'movimientos' && (
          <div className="card" style={{ padding: '20px 24px' }}>
            <div className="section-title">Movimientos de corral</div>
            <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: -8, marginBottom: 14 }}>
              Se registran solos cada vez que el animal cambia de corral.
            </p>
            <ListaEventos eventos={eventosMovimiento} vacio="Sin movimientos de corral registrados" />
          </div>
        )}

        {tab === 'historial' && (
          <div className="card" style={{ padding: '24px 28px', marginBottom: 24 }}>
            <div className="section-title">Bitácora — historial completo</div>
            <ListaEventos
              eventos={timeline}
              vacio="Todavía no hay eventos registrados"
              onRegistrarParto={setPartoEventoId} puedeRegistrarParto={puedeMonta}
              onEditar={manejarEditar} puedeEditar={(tipo) => PERMISO_POR_TIPO[tipo]}
            />
          </div>
        )}

        {tab === 'genealogia' && (
          <div className="card" style={{ padding: '20px 24px', marginBottom: 24 }}>
            <div className="section-title">Árbol genealógico</div>
            <ArbolGenealogico animalId={animalId} onAbrirSeguimiento={onCambiarAnimal} />
          </div>
        )}

        {tab === 'notas' && (
          <DiarioNotas animalId={animalId} notas={notas} onActualizado={cargar} />
        )}
      </div>

      {modalActivo === 'pesaje' && puedePesaje && <RegistrarPesajeModal animalId={animalId} animal={animal} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar(MENSAJES_ACCION.pesaje)} />}
      {modalActivo === 'salud-vacuna' && puedeSalud && <RegistrarSaludModal animalId={animalId} animal={animal} prellenado={{ tipo: 'vacuna' }} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar(MENSAJES_ACCION.salud)} />}
      {modalActivo === 'salud-tratamiento' && puedeSalud && <RegistrarSaludModal animalId={animalId} animal={animal} prellenado={{ tipo: 'tratamiento' }} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar(MENSAJES_ACCION.salud)} />}
      {modalActivo === 'salud-diagnostico' && puedeSalud && <RegistrarSaludModal animalId={animalId} animal={animal} prellenado={{ tipo: 'diagnostico' }} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar(MENSAJES_ACCION.salud)} />}
      {modalActivo === 'salud-rapida' && puedeSalud && <RegistrarSaludModal animalId={animalId} animal={animal} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar(MENSAJES_ACCION.salud)} />}
      {modalActivo === 'observacion-rapida' && puedeReportarObservacion && <CambiarEstadoSaludModal animal={animal} soloObservacion onCerrar={() => setModalActivo(null)} onGuardado={() => cerrarYRecargar(MENSAJES_ACCION.observacion)} />}
      {modalActivo === 'alimentacion' && puedeAlimentacion && <RegistrarAlimentacionModal animalId={animalId} animal={animal} onCerrar={() => setModalActivo(null)} onCreado={cerrarAlimentacion} />}
      {modalActivo === 'leche' && puedeLeche && <RegistrarLecheModal animalId={animalId} animal={animal} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar(MENSAJES_ACCION.leche)} />}
      {modalActivo === 'mover-rapido' && puedeEditarAnimal && <MoverAnimalModal animal={animal} onCerrar={() => setModalActivo(null)} onCreado={cerrarMovimiento} />}
      {modalActivo === 'nota-rapida' && puedeNota && <NotaRapidaModal animal={animal} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar(MENSAJES_ACCION.nota)} />}
      {modalActivo === 'condicion' && puedeCondicion && <RegistrarCondicionModal animalId={animalId} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar('Condición corporal guardada.')} />}
      {modalActivo === 'monta' && puedeMonta && <RegistrarMontaModal animalId={animalId} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar('Evento reproductivo registrado.')} onNoDisponible={manejarAnimalReproductivoNoDisponible} />}
      {modalActivo === 'diagnostico-gestacion' && puedeMonta && cicloReproductivo?.id && <RegistrarDiagnosticoGestacionModal cicloId={cicloReproductivo.id} servicios={cicloReproductivo.servicios} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar('Diagnóstico de gestación registrado.')} onNoDisponible={manejarAnimalReproductivoNoDisponible} />}
      {modalActivo === 'parto-v2' && puedeMonta && cicloReproductivo?.id && <RegistrarPartoModal cicloId={cicloReproductivo.id} madreId={animal.id} onCerrar={() => setModalActivo(null)} onCreado={() => cerrarYRecargar('Parto registrado.')} onNoDisponible={manejarAnimalReproductivoNoDisponible} />}
      {modalActivo === 'baja' && puedeBaja && <BajaAnimalModal animalId={animalId} onCerrar={() => setModalActivo(null)} onCreado={(resultado) => cerrarYRecargar(resultado?.tipo === 'vendido' ? 'Venta registrada correctamente.' : 'Baja del animal registrada.')} />}
      {modalActivo === 'editar-animal' && puedeEditarAnimal && <EditarAnimalModal animal={animal} onCerrar={() => setModalActivo(null)} onGuardado={() => cerrarYRecargar('Datos del animal actualizados.')} />}
      {modalActivo === 'estado-salud' && puedeEstadoSalud && <CambiarEstadoSaludModal animal={animal} soloObservacion={!puedeEstadoClinico} onCerrar={() => setModalActivo(null)} onGuardado={() => cerrarYRecargar('Estado de salud actualizado.')} />}
      {modalActivo === 'categoria' && puedeCategoria && <CambiarCategoriaModal animal={animal} onCerrar={() => setModalActivo(null)} onGuardado={() => cerrarYRecargar('Categoría del animal actualizada.')} />}
      {modalActivo === 'asignar-plan' && puedeAsignarPlan && <AsignarPlanAnimalModal animalId={animalId} onCerrar={() => setModalActivo(null)} onListo={() => cerrarYRecargar('Plan sanitario asignado.')} />}
      {modalActivo === 'resumen-ia' && puedeResumenIA && <ResumenIAModal animalId={animalId} onCerrar={() => setModalActivo(null)} />}
      {modalActivo === 'qr' && <CodigoQRModal animal={animal} onCerrar={() => setModalActivo(null)} />}
      {aplicandoItem && (
        <RegistrarSaludModal
          animalId={animalId}
          animal={animal}
          prellenado={{ tipo: aplicandoItem.tipo, insumo_id: aplicandoItem.insumo_id, descripcion: aplicandoItem.descripcion, nombre_evento: aplicandoItem.nombre_evento, planNombre: aplicandoItem.plan_nombre, planItemId: aplicandoItem.item_id }}
          onCerrar={() => setAplicandoItem(null)}
          onCreado={() => { setAplicandoItem(null); cerrarEdicionYRecargar('Tratamiento registrado.'); }}
        />
      )}
      {edicion?.tipo === 'pesaje' && <RegistrarPesajeModal animalId={animalId} registro={edicion.registro} onCerrar={() => setEdicion(null)} onCreado={() => cerrarEdicionYRecargar('Pesaje actualizado.')} />}
      {edicion?.tipo === 'salud' && <RegistrarSaludModal animalId={animalId} registro={edicion.registro} onCerrar={() => setEdicion(null)} onCreado={() => cerrarEdicionYRecargar('Evento de salud actualizado.')} />}
      {edicion?.tipo === 'alimentacion' && <RegistrarAlimentacionModal animalId={animalId} registro={edicion.registro} onCerrar={() => setEdicion(null)} onCreado={() => cerrarEdicionYRecargar('Alimentación actualizada.')} />}
      {edicion?.tipo === 'leche' && <RegistrarLecheModal animalId={animalId} registro={edicion.registro} onCerrar={() => setEdicion(null)} onCreado={() => cerrarEdicionYRecargar('Producción de leche actualizada.')} />}
      {edicion?.tipo === 'condicion' && <RegistrarCondicionModal animalId={animalId} registro={edicion.registro} onCerrar={() => setEdicion(null)} onCreado={() => cerrarEdicionYRecargar('Condición corporal actualizada.')} />}
    </div>
  );
}
