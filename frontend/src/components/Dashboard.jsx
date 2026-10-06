import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAlertas } from '../context/AlertasContext.jsx';
import { ROLES } from '../authorization/permissions.js';
import ClimaPanel from './ClimaPanel.jsx';
import {
  IconoAnimal, IconoBalanza, IconoCampana, IconoCapas,
  IconoCorral, IconoCorazon, IconoHoja, IconoLibro, IconoLista, IconoReportes, IconoSalud, IconoTendencia,
} from './Iconos.jsx';
import { exportarReporteEjecutivo } from '../exportUtils.js';
import { rutaParaVista } from '../routing.js';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import ModuleHeader from './ModuleHeader.jsx';
import { estadoOperativoCorral, ordenarCorrales } from '../monitoringUx.js';
import {
  mensajeCargaParcial, resolverCargaParcial, respuestaEsArreglo, respuestaEsObjeto,
} from '../cargasParciales.js';

const DIAS_PARTO_PROXIMO = 30;

function formatearFecha(fecha) {
  if (!fecha) return 'Sin fecha';
  return new Date(fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function WidgetHeader({ eyebrow, titulo, accion, onAccion }) {
  return (
    <div className="ops-widget-header">
      <div><span>{eyebrow}</span><h2>{titulo}</h2></div>
      {accion && <button type="button" onClick={onAccion}>{accion}<span aria-hidden="true">↗</span></button>}
    </div>
  );
}

function DonutSalud({ sano, observacion, enfermo }) {
  const total = sano + observacion + enfermo;
  const porcentaje = total ? Math.round((sano / total) * 100) : 0;
  const finSanos = total ? (sano / total) * 360 : 0;
  const finObservacion = total ? ((sano + observacion) / total) * 360 : 0;
  return <div className={`ops-health-donut ${total ? '' : 'is-empty'}`} style={{ '--health-sano': `${finSanos}deg`, '--health-observacion': `${finObservacion}deg` }} role="img" aria-label={total ? `${porcentaje}% del hato saludable` : 'Sin distribución de salud registrada'}><div><strong>{total ? `${porcentaje}%` : '—'}</strong><span>{total ? 'saludable' : 'sin datos'}</span></div></div>;
}

function ListaWidget({ items, vacio, render, limite = 4 }) {
  if (items === null) return <EstadoCarga mensaje="Cargando…" compacto />;
  if (!items?.length) return <EstadoVacio titulo={vacio} compacto />;
  return <div className="ops-list">{items.slice(0, limite).map(render)}</div>;
}

function IndicadorOperacion({ icono: Icono, etiqueta, valor, detalle, tono = 'animals', onClick }) {
  const contenido = <><span className={`ops-metric-icon tone-${tono}`}><Icono /></span><span><small>{etiqueta}</small><strong>{valor ?? '—'}</strong><em>{detalle}</em></span></>;
  return onClick
    ? <button type="button" className="ops-operation-metric" onClick={onClick}>{contenido}</button>
    : <div className="ops-operation-metric">{contenido}</div>;
}

export default function Dashboard({ onCapturaRapida }) {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const irA = (vista) => navigate(rutaParaVista(vista));
  const { resumen, total: totalAlertas } = useAlertas() || {};
  const [reporte, setReporte] = useState(null);
  const [vacunas, setVacunas] = useState(null);
  const [tareas, setTareas] = useState(null);
  const [gestaciones, setGestaciones] = useState(null);
  const [corrales, setCorrales] = useState(null);
  const [generandoReporte, setGenerandoReporte] = useState(false);
  const [errorCarga, setErrorCarga] = useState(null);

  const esRolOperativo = [ROLES.TRABAJADOR, ROLES.VETERINARIO].includes(usuario?.rol);

  function cargarDashboard() {
    setErrorCarga(null);
    const solicitudes = [
      { clave: 'resumen', etiqueta: 'Resumen del rancho', ruta: '/api/reportes/resumen', promesa: api.reporteResumen(), aplicar: setReporte, valorInicial: {}, validar: respuestaEsObjeto },
      { clave: 'vacunas', etiqueta: 'Próximas vacunas', ruta: '/api/salud/proximas?dias=14', promesa: api.proximasVacunas(14), aplicar: setVacunas, valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'tareas', etiqueta: 'Tareas pendientes', ruta: '/api/asignaciones', promesa: api.listarTareas().then((lista) => lista.filter((tarea) => ['pendiente', 'en_progreso'].includes(tarea.estado || (tarea.completada ? 'completada' : 'pendiente')))), aplicar: setTareas, valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'partos', etiqueta: 'Próximos partos', ruta: `/api/reproduccion/partos-proximos?dias=${DIAS_PARTO_PROXIMO}`, promesa: api.partosProximos(DIAS_PARTO_PROXIMO), aplicar: setGestaciones, valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'corrales', etiqueta: 'Corrales', ruta: '/api/corrales', promesa: api.listarCorrales(), aplicar: setCorrales, valorInicial: [], validar: respuestaEsArreglo },
    ];
    resolverCargaParcial(solicitudes, { contexto: 'Dashboard', rol: usuario?.rol }).then((diagnostico) => {
      setErrorCarga(mensajeCargaParcial(diagnostico));
    });
  }

  useEffect(cargarDashboard, [usuario?.rol]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generarReporteEjecutivo() {
    setGenerandoReporte(true);
    try {
      const [resumenActual, financiero, alertas] = await Promise.all([
        reporte || api.reporteResumen(), api.reporteFinanciero(), api.resumenAlertas(),
      ]);
      await exportarReporteEjecutivo({ resumen: resumenActual, financiero, alertas });
    } catch (err) {
      alert(`No se pudo generar el reporte: ${err.message}`);
    } finally {
      setGenerandoReporte(false);
    }
  }

  const saludo = (() => {
    const hora = new Date().getHours();
    if (hora < 12) return 'Buenos días';
    if (hora < 19) return 'Buenas tardes';
    return 'Buenas noches';
  })();

  const proximosPartos = (gestaciones || []).filter((gestacion) => {
    const dias = (new Date(gestacion.fecha_parto_estimada) - new Date()) / 86400000;
    return dias >= 0 && dias <= DIAS_PARTO_PROXIMO;
  });
  const vacunasProximas = (vacunas || []).filter((evento) => evento.tipo === 'vacuna');
  const estadoSalud = Object.fromEntries((reporte?.animales_por_estado_salud || []).map((estado) => [estado.estado_salud, estado.total]));

  const accionesRapidas = useMemo(() => ({
    [ROLES.ADMINISTRADOR]: [
      { label: 'Captura rápida', ayuda: 'Pesaje, alimento, salud y más', icono: IconoAnimal, ejecutar: () => onCapturaRapida() },
      { label: 'Registrar pesaje', ayuda: 'Buscar animal y guardar peso', icono: IconoBalanza, ejecutar: () => onCapturaRapida('pesaje') },
      { label: 'Trabajo por lote', ayuda: 'Atender varios animales', icono: IconoCapas, vista: 'lote' },
      { label: 'Revisar alertas', ayuda: 'Ver lo urgente', icono: IconoCampana, vista: 'alertas' },
    ],
    [ROLES.VETERINARIO]: [
      { label: 'Registrar atención', ayuda: 'Tratamiento o vacuna', icono: IconoSalud, ejecutar: () => onCapturaRapida('salud') },
      { label: 'Reportar revisión', ayuda: 'Marcar un animal para revisar', icono: IconoCampana, ejecutar: () => onCapturaRapida('observacion') },
      { label: 'Buscar animal', ayuda: 'Abrir su seguimiento', icono: IconoAnimal, vista: 'seguimiento' },
      { label: 'Tareas pendientes', ayuda: 'Trabajo del equipo', icono: IconoLista, vista: 'tareas' },
    ],
    [ROLES.TRABAJADOR]: [
      { label: 'Registrar alimentación', ayuda: 'Buscar animal y descontar stock', icono: IconoHoja, ejecutar: () => onCapturaRapida('alimentacion') },
      { label: 'Registrar pesaje', ayuda: 'Guardar el peso de hoy', icono: IconoBalanza, ejecutar: () => onCapturaRapida('pesaje') },
      { label: 'Reportar revisión', ayuda: 'Avisar al veterinario', icono: IconoCampana, ejecutar: () => onCapturaRapida('observacion') },
      { label: 'Tareas pendientes', ayuda: 'Trabajo del equipo', icono: IconoLista, vista: 'tareas' },
    ],
    [ROLES.AUDITOR]: [
      { label: 'Ver reportes', ayuda: 'Resumen del rancho', icono: IconoReportes, vista: 'reportes' },
      { label: 'Ver finanzas', ayuda: 'Ingresos y egresos', icono: IconoBalanza, vista: 'finanzas' },
      { label: 'Abrir bitácora', ayuda: 'Revisar cambios', icono: IconoLibro, vista: 'bitacora' },
      { label: 'Rentabilidad', ayuda: 'Resultado por animal', icono: IconoTendencia, vista: 'rentabilidad' },
    ],
  })[usuario?.rol] || [], [usuario?.rol, onCapturaRapida]);

  const totalSalud = Number(estadoSalud.sano || 0) + Number(estadoSalud.observacion || 0) + Number(estadoSalud.enfermo || 0);
  const fechaHoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className={`dashboard-inicio ops-dashboard ${esRolOperativo ? 'dashboard-rol-operativo' : ''}`}>
      <div className="dashboard-top-row">
        <ModuleHeader
          eyebrow={`${saludo}, ${usuario?.nombre?.split(' ')[0]} · ${fechaHoy}`}
          title="Cómo está el rancho hoy"
          description={esRolOperativo ? 'Tu jornada y lo que requiere atención, de un vistazo.' : 'El estado operativo y las decisiones que requieren atención hoy.'}
          icon={IconoCorral}
          accent="campo"
          status={<span className="ops-live-status"><i /> Información actual</span>}
          action={<button className="ops-icon-button" onClick={generarReporteEjecutivo} disabled={generandoReporte} title="Descargar reporte PDF" aria-label="Descargar reporte PDF"><IconoReportes /></button>}
        />
        <aside className="dashboard-weather-card" aria-label="Clima del rancho"><ClimaPanel compacto /></aside>
      </div>

      {errorCarga && <EstadoError mensaje={errorCarga} onReintentar={cargarDashboard} />}

      <section className="ops-control-panel dashboard-resumen-general" aria-labelledby="operacion-hoy">
        <div className="ops-control-heading"><div><span>Resumen operativo</span><h2 id="operacion-hoy">Operación en cifras</h2><p>Datos esenciales para decidir qué atender primero.</p></div><button type="button" onClick={() => irA('animales')}>Ver animales <span aria-hidden="true">→</span></button></div>
        <div className="ops-operation-metrics">
          <IndicadorOperacion icono={IconoAnimal} etiqueta="Ganado activo" valor={reporte?.total_animales_vivos} detalle={reporte?.peso_promedio_kg ? `${reporte.peso_promedio_kg} kg promedio` : 'Peso promedio pendiente'} tono="animals" onClick={() => irA('animales')} />
          <IndicadorOperacion icono={IconoSalud} etiqueta="Salud general" valor={totalSalud ? `${Math.round((Number(estadoSalud.sano || 0) / totalSalud) * 100)}%` : '—'} detalle={totalSalud ? `${estadoSalud.enfermo || 0} con atención clínica` : 'Sin estados registrados'} tono="health" onClick={() => irA('planes-sanitarios')} />
          <IndicadorOperacion icono={IconoLista} etiqueta="Tareas activas" valor={tareas?.length} detalle={esRolOperativo ? 'Asignadas a tu jornada' : 'Pendientes del equipo'} tono="tasks" onClick={() => irA('tareas')} />
          <IndicadorOperacion icono={IconoCampana} etiqueta="Requieren atención" valor={totalAlertas || 0} detalle={totalAlertas ? 'Revisar condiciones activas' : 'Sin alertas activas'} tono="alerts" onClick={() => irA('alertas')} />
          <IndicadorOperacion icono={IconoCorral} etiqueta="Corrales por revisar" valor={resumen?.corrales_casi_llenos ?? 0} detalle={`${corrales?.length ?? 0} corrales registrados`} tono="corrals" onClick={() => irA('corrales')} />
        </div>
        <div className="ops-control-footer"><span><i /> Información actual del sistema</span><small>Los detalles y acciones aparecen debajo en orden de prioridad.</small></div>
      </section>

      <div className="ops-dashboard-grid">
        <div className="dashboard-primary-row">
          <div className="dashboard-priority-stack">
            <section className="ops-widget ops-attention-widget dashboard-pendientes dashboard-prioridad">
              <WidgetHeader eyebrow="Prioridad" titulo="Atención inmediata" accion="Abrir alertas" onAccion={() => irA('alertas')} />
              <div className="ops-attention-list">
                <button type="button" className={totalAlertas ? 'is-urgent' : ''} onClick={() => irA('alertas')}><span className="ops-metric-icon tone-alerts"><IconoCampana /></span><span><strong>Alertas activas</strong><small>{totalAlertas ? 'Hay condiciones que necesitan revisión.' : 'No hay alertas operativas activas.'}</small></span><b>{totalAlertas || 0}</b><i aria-hidden="true">→</i></button>
                <button type="button" className={resumen?.stock_bajo ? 'is-warning' : ''} onClick={() => irA('insumos')}><span className="ops-metric-icon tone-inventory"><IconoHoja /></span><span><strong>Inventario bajo</strong><small>{resumen?.stock_bajo ? 'Conviene preparar reposición de insumos.' : 'Existencias sin faltantes reportados.'}</small></span><b>{resumen?.stock_bajo ?? 0}</b><i aria-hidden="true">→</i></button>
                <button type="button" className={resumen?.corrales_casi_llenos ? 'is-warning' : ''} onClick={() => irA('corrales')}><span className="ops-metric-icon tone-corrals"><IconoCorral /></span><span><strong>Capacidad de corrales</strong><small>{resumen?.corrales_casi_llenos ? 'Revisar espacios próximos a su capacidad.' : 'Sin corrales próximos al límite.'}</small></span><b>{resumen?.corrales_casi_llenos ?? 0}</b><i aria-hidden="true">→</i></button>
              </div>
            </section>
            <section className="ops-widget ops-tasks-widget dashboard-mis-tareas dashboard-prioridad">
              <WidgetHeader eyebrow={esRolOperativo ? 'Tu jornada' : 'Equipo'} titulo={esRolOperativo ? 'Mis tareas de hoy' : 'Tareas activas'} accion="Ver todas" onAccion={() => irA('tareas')} />
              <div className="ops-task-count"><strong>{tareas?.length ?? '—'}</strong><span>pendientes activas</span></div>
              <ListaWidget items={tareas} vacio="La jornada está al día" render={(tarea) => <button type="button" className="ops-task-row" key={tarea.id} onClick={() => irA('tareas')}><i className={`priority-${tarea.prioridad || 'media'}`} /><span><strong>{tarea.descripcion}</strong><small>{(tarea.corrales || []).map((corral) => corral.nombre).join(', ') || tarea.corral || tarea.trabajador || 'Sin contexto adicional'}</small></span><time>{formatearFecha(tarea.fecha)}</time></button>} />
            </section>
          </div>
          <section className="ops-widget ops-actions-widget dashboard-acciones" aria-labelledby="acciones-rapidas">
            <WidgetHeader eyebrow="Registrar" titulo="Acciones rápidas" />
            <p className="ops-widget-intro">Empieza una captura sin recorrer todo el sistema.</p>
            <div className="ops-action-list" id="acciones-rapidas">{accionesRapidas.map((accion, indice) => { const Icono = accion.icono; return <button key={accion.label} className={`ops-action action-${indice}`} onClick={() => accion.ejecutar ? accion.ejecutar() : irA(accion.vista)}><span><Icono /></span><span><strong>{accion.label}</strong><small>{accion.ayuda}</small></span><i aria-hidden="true">→</i></button>; })}</div>
          </section>
        </div>

        <div className="dashboard-secondary-row">
          <section className="ops-widget ops-corrals-widget">
            <WidgetHeader eyebrow="Espacios" titulo="Estado de corrales" accion="Abrir corrales" onAccion={() => irA('corrales')} />
            <div className="ops-corral-list ops-corral-direct" aria-label="Ocupación y atención por corral"><ListaWidget items={corrales ? ordenarCorrales(corrales) : corrales} vacio="Sin corrales registrados" limite={5} render={(corral) => { const estado = estadoOperativoCorral(corral); const porcentaje = Math.round(estado.porcentaje); return <button type="button" className={`corral-state-${estado.id}`} key={corral.id} onClick={() => irA('corrales')}><span className="ops-corral-name"><strong>{corral.nombre}</strong><small>{corral.ocupacion_actual} / {corral.capacidad_maxima} animales</small></span><span className="ops-capacity" aria-label={`${porcentaje}% de ocupación`}><i style={{ width: `${porcentaje}%` }} /></span><b>{porcentaje}%</b><em>{estado.texto}</em></button>; }} /></div>
          </section>
          <div className="dashboard-insight-stack">
            <section className="ops-widget ops-health-widget">
              <WidgetHeader eyebrow="Estado clínico" titulo="Salud del hato" accion="Abrir sanidad" onAccion={() => irA('planes-sanitarios')} />
              <div className="ops-health-summary"><DonutSalud sano={Number(estadoSalud.sano || 0)} observacion={Number(estadoSalud.observacion || 0)} enfermo={Number(estadoSalud.enfermo || 0)} /><div className="ops-health-legend"><span><i className="healthy" /><small>Sanos</small><strong>{estadoSalud.sano ?? 0}</strong></span><span><i className="watch" /><small>Observación</small><strong>{estadoSalud.observacion ?? 0}</strong></span><span><i className="sick" /><small>Atención</small><strong>{estadoSalud.enfermo ?? 0}</strong></span></div></div>
              <p>{totalSalud ? `${totalSalud} animales tienen estado clínico registrado.` : 'Registra el estado de salud para visualizar su distribución.'}</p>
            </section>
            <section className="ops-widget ops-care-widget">
              <WidgetHeader eyebrow="Lo que sigue" titulo="Próximos eventos" accion="Calendario" onAccion={() => irA('calendario')} />
              <div className="ops-care-metrics"><button onClick={() => irA('planes-sanitarios')}><span className="ops-icon-bubble tone-health"><IconoSalud /></span><strong>{vacunas === null ? '—' : vacunasProximas.length}</strong><small>Vacunas próximas</small></button><button onClick={() => irA('reproduccion')}><span className="ops-icon-bubble tone-reproduction"><IconoCorazon /></span><strong>{gestaciones === null ? '—' : proximosPartos.length}</strong><small>Partos en {DIAS_PARTO_PROXIMO} días</small></button><button onClick={() => irA('insumos')}><span className="ops-icon-bubble tone-inventory"><IconoHoja /></span><strong>{resumen?.stock_bajo ?? '—'}</strong><small>Insumos bajos</small></button></div>
              <ListaWidget items={vacunas} vacio="No hay cuidados próximos" limite={2} render={(evento) => <button type="button" className="ops-event-row" key={evento.id} onClick={() => irA('planes-sanitarios')}><span><strong>{evento.nombre_evento || evento.tipo}</strong><small>{evento.arete_id} · {evento.nombre_alias || 'Sin alias'}</small></span><time>{formatearFecha(evento.proxima_dosis)}</time></button>} />
            </section>
          </div>
        </div>

      </div>
    </div>
  );
}
