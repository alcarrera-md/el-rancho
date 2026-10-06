import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { construirAtencionReproductiva, construirHatoOperable, coincideFiltroReproductivo, metricasEstadoHato } from '../reproduccionUx.js';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import ModuleHeader from './ModuleHeader.jsx';
import ReproduccionMasiva from './ReproduccionMasiva.jsx';
import ReproduccionAnalitica from './ReproduccionAnalitica.jsx';
import { IconoAnimal, IconoCalendario, IconoCheck, IconoCorazon, IconoLista } from './Iconos.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import ReproduccionEconomica from './ReproduccionEconomica.jsx';

function formatearFecha(valor) {
  if (!valor) return 'Sin fecha definida';
  return new Date(`${String(valor).slice(0, 10)}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function tiempoRespectoAFecha(valor) {
  if (!valor) return 'Fecha por definir';
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
  const dias = Math.round((fecha - hoy) / 86400000);
  if (dias === 0) return 'Corresponde hoy';
  if (dias < 0) return `Hace ${Math.abs(dias)} día${dias === -1 ? '' : 's'} que debía revisarse`;
  return `Faltan ${dias} día${dias === 1 ? '' : 's'}`;
}

function identidad(fila) {
  return { arete: fila.animal.arete_id || 'Sin arete', nombre: fila.animal.nombre_alias || 'Sin alias' };
}

function abrirAccion(onAbrirSeguimiento, fila, soloSeguimiento = false) {
  onAbrirSeguimiento(fila.animal.id, { seccion: 'reproduccion', accion: soloSeguimiento || fila.accion.id === 'seguimiento' ? null : fila.accion.id });
}

function IconoEstado({ codigo }) {
  const Icono = codigo === 'proxima_parto' ? IconoCalendario
    : ['prenada', 'parida'].includes(codigo) ? IconoCorazon
      : ['requiere_revision', 'vacia', 'perdida_aborto'].includes(codigo) ? IconoCheck : IconoLista;
  return <Icono aria-hidden="true" />;
}

function TarjetaAtencion({ fila, onAbrirSeguimiento }) {
  const animal = identidad(fila);
  return <article className={`repro-attention-card priority-${fila.prioridad}`}>
    <div className="repro-attention-identity"><span className="repro-attention-mark"><IconoEstado codigo={fila.codigo} /></span><div><button type="button" onClick={() => abrirAccion(onAbrirSeguimiento, fila, true)}>#{animal.arete}</button><strong>{fila.motivo}</strong><span>{animal.nombre} · {fila.corral}</span></div></div>
    <div className="repro-attention-date"><small>{fila.detalle}</small><time>{formatearFecha(fila.fecha)}</time><span>{tiempoRespectoAFecha(fila.fecha)}</span></div>
    <button type="button" className="btn btn-primary" onClick={() => abrirAccion(onAbrirSeguimiento, fila)}>{fila.accion.etiqueta}</button>
  </article>;
}

function TarjetaHato({ fila, onAbrirSeguimiento }) {
  const animal = identidad(fila);
  return <article className="repro-field-card">
    <header><button type="button" className="repro-ear-tag" onClick={() => abrirAccion(onAbrirSeguimiento, fila, true)}>#{animal.arete}</button><span className={`repro-state state-${fila.codigo}`}><IconoEstado codigo={fila.codigo} />{fila.etiqueta}</span></header>
    <div className="repro-field-identity"><strong>{animal.nombre}</strong><span><IconoAnimal aria-hidden="true" />{fila.corral}</span></div>
    <dl className="repro-field-progress"><div><dt>Último</dt><dd>{fila.ultimaAccion.etiqueta}{fila.ultimaAccion.fecha ? ` · ${formatearFecha(fila.ultimaAccion.fecha)}` : ''}</dd></div><div><dt>Próximo</dt><dd>{fila.accion.etiqueta}{fila.fechaReferencia ? ` · ${formatearFecha(fila.fechaReferencia)}` : ''}</dd></div></dl>
    <button type="button" className="btn btn-primary" onClick={() => abrirAccion(onAbrirSeguimiento, fila)}>{fila.accion.etiqueta}</button>
  </article>;
}

function textoBusqueda(fila) {
  return [fila.animal.arete_id, fila.animal.nombre_alias, fila.corral]
    .filter(Boolean).join(' ').toLocaleLowerCase('es-MX');
}

function SelectorEvento({ filas, consulta, onConsulta, onCerrar, onAbrirSeguimiento }) {
  const campo = useRef(null);
  useEffect(() => { campo.current?.focus(); }, []);
  const termino = consulta.trim().toLocaleLowerCase('es-MX');
  const resultados = termino ? filas.filter((fila) => textoBusqueda(fila).includes(termino)).slice(0, 12) : filas.slice(0, 8);
  return <section className="repro-event-picker" aria-labelledby="repro-event-picker-title">
    <header><div><span>Registro individual</span><h2 id="repro-event-picker-title">Selecciona una vaca</h2><p>Busca por arete, nombre o corral. Solo verás la acción compatible con su estado actual.</p></div><button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button></header>
    <label className="repro-search"><span>Buscar vaca</span><input ref={campo} type="search" value={consulta} onChange={(e) => onConsulta(e.target.value)} placeholder="Ej. 248, Lucera o Corral Norte" autoComplete="off" /></label>
    <p className="repro-results-summary" role="status">{termino ? `${resultados.length} coincidencia${resultados.length === 1 ? '' : 's'}` : 'Vacas disponibles para trabajo reproductivo'}</p>
    {resultados.length ? <div className="repro-picker-results">{resultados.map((fila) => {
      const animal = identidad(fila);
      return <article key={fila.animal.id}>
        <button type="button" className="repro-picker-animal" onClick={() => abrirAccion(onAbrirSeguimiento, fila, true)}><strong>#{animal.arete} · {animal.nombre}</strong><span>{fila.corral}</span></button>
        <span className={`repro-state state-${fila.codigo}`}>{fila.etiqueta}</span>
        <button type="button" className="btn btn-primary" onClick={() => abrirAccion(onAbrirSeguimiento, fila)}>{fila.ciclo ? fila.accion.etiqueta : 'Registrar primer servicio'}</button>
      </article>;
    })}</div> : <EstadoVacio titulo="No encontramos esa vaca." descripcion="Prueba con otro arete, nombre o corral. También puedes limpiar la búsqueda para ver el hato operable." compacto />}
  </section>;
}

const METRICAS = [
  ['prenada', 'Preñadas', IconoCorazon], ['pendiente_diagnostico', 'Pendientes', IconoLista],
  ['requiere_revision', 'Revisión', IconoCheck], ['proxima_parto', 'Próximas', IconoCalendario],
  ['vacia', 'Vacías', IconoAnimal],
];

const VACIO_POR_ESTADO = {
  prenada: 'No hay vacas preñadas.', pendiente_diagnostico: 'No hay vacas pendientes de diagnóstico.',
  requiere_revision: 'No hay vacas que requieran revisión.', proxima_parto: 'No hay vacas próximas a parto.',
  vacia: 'No hay vacas vacías.',
};

export default function Reproduccion({ onAbrirSeguimiento }) {
  const { usuario } = useAuth();
  const [fuente, setFuente] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [filtros, setFiltros] = useState({ estado: 'todos', corral: 'todos', periodo: 'todos', toro: 'todos', accion: 'todos' });
  const [herramienta, setHerramienta] = useState(null);
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  async function cargar() {
    setErrorCarga(null); setFuente(null);
    try {
      const datos = await api.obtenerHatoReproductivoOperable();
      if (!Array.isArray(datos)) throw new Error('El servidor devolvió una respuesta inesperada.');
      setFuente(datos);
    }
    catch (error) { setErrorCarga(`No se pudo cargar el trabajo reproductivo (${error.message}).`); setFuente([]); }
  }

  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hato = useMemo(() => construirHatoOperable(fuente || []), [fuente]);
  const atencion = useMemo(() => construirAtencionReproductiva(hato), [hato]);
  const metricas = useMemo(() => metricasEstadoHato(hato), [hato]);
  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase('es-MX');
    return hato.filter((fila) => coincideFiltroReproductivo(fila, filtros) && (!termino || textoBusqueda(fila).includes(termino)));
  }, [hato, filtros, busqueda]);
  const corrales = useMemo(() => [...new Set(hato.map((fila) => fila.corral))].sort(), [hato]);
  const toros = useMemo(() => {
    const mapa = new Map();
    hato.forEach((fila) => { if (fila.servicio?.macho_id) mapa.set(String(fila.servicio.macho_id), fila.servicio.macho_arete || `Toro ${fila.servicio.macho_id}`); });
    return [...mapa.entries()];
  }, [hato]);

  function cambiarFiltro(clave, valor) { setFiltros((actual) => ({ ...actual, [clave]: valor })); }
  function seleccionarMetrica(clave) {
    cambiarFiltro('estado', filtros.estado === clave ? 'todos' : clave);
    document.querySelector('.repro-work-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const filtrosActivos = Object.values(filtros).filter((valor) => valor !== 'todos').length;
  const tituloVacio = VACIO_POR_ESTADO[filtros.estado] || 'No hay resultados para estos filtros.';

  const puedeCapturar = tienePermiso(usuario?.rol, 'reproduccion', 'crear');
  const acciones = <div className="repro-header-tools">{puedeCapturar && <button type="button" className="btn btn-primary repro-register-event" onClick={() => { setHerramienta(null); setSelectorAbierto(true); }}>+ Registrar evento</button>}<details className="repro-more-tools"><summary>Más opciones</summary><div>{puedeCapturar && <><button type="button" className="btn btn-ghost" onClick={() => setHerramienta('captura')}>Captura masiva</button><button type="button" className="btn btn-ghost" onClick={() => setHerramienta('importacion')}>Importar Excel</button></>}<button type="button" className="btn btn-ghost" onClick={() => setHerramienta('exportacion')}>Exportar</button></div></details></div>;

  return <div className="repro-screen">
    <ModuleHeader eyebrow="Trabajo reproductivo" title="Estado reproductivo del hato" description="Revisa qué vacas necesitan atención y registra cada etapa del ciclo reproductivo." icon={IconoCorazon} accent="animal" className="repro-module-header" action={acciones} />
    {herramienta ? <ReproduccionMasiva modoInicial={herramienta} onCerrar={() => setHerramienta(null)} onTerminar={() => { setHerramienta(null); cargar(); }} /> : <>
    {errorCarga && <EstadoError mensaje={errorCarga} onReintentar={cargar} />}
    {fuente === null ? <EstadoCarga mensaje="Preparando el trabajo reproductivo…" /> : <>
      {selectorAbierto && puedeCapturar && <SelectorEvento filas={hato} consulta={busqueda} onConsulta={setBusqueda} onCerrar={() => setSelectorAbierto(false)} onAbrirSeguimiento={onAbrirSeguimiento} />}
      {!selectorAbierto && <button type="button" className="repro-mobile-register btn btn-primary" onClick={() => setSelectorAbierto(true)}>+ Registrar evento</button>}
      <section className="repro-attention" aria-labelledby="repro-atencion-titulo">
        <header><div><span>Primero en la jornada</span><h2 id="repro-atencion-titulo">Qué requiere atención</h2></div><b>{atencion.length}</b></header>
        {atencion.length ? <div className="repro-attention-list">{atencion.map((fila) => <TarjetaAtencion key={`${fila.animal.id}-${fila.motivo}`} fila={fila} onAbrirSeguimiento={onAbrirSeguimiento} />)}</div> : <EstadoVacio titulo="No hay pendientes reproductivos." descripcion="Cuando una vaca necesite diagnóstico, revisión o seguimiento aparecerá aquí." compacto />}
      </section>

      <nav className="repro-state-strip" aria-label="Filtrar por estado reproductivo">{METRICAS.map(([clave, etiqueta, Icono]) => <button type="button" key={clave} className={filtros.estado === clave ? 'is-active' : ''} onClick={() => seleccionarMetrica(clave)} aria-pressed={filtros.estado === clave}><Icono /><span>{etiqueta}</span><strong>{metricas[clave].length}</strong></button>)}</nav>

      <section className="repro-work-list" aria-labelledby="repro-listado-titulo">
        <header><div><span>Operables ahora</span><h2 id="repro-listado-titulo">Vacas del hato</h2><p>Solo animales vivos y disponibles para trabajo reproductivo.</p></div><button type="button" className="btn btn-ghost repro-filter-toggle" onClick={() => setFiltrosAbiertos((valor) => !valor)} aria-expanded={filtrosAbiertos}>Filtros{filtrosActivos ? ` (${filtrosActivos})` : ''}</button></header>
        {filtrosAbiertos && <div className="repro-filters">
          <label><span>Estado</span><select value={filtros.estado} onChange={(e) => cambiarFiltro('estado', e.target.value)}><option value="todos">Todos</option>{METRICAS.map(([clave, etiqueta]) => <option key={clave} value={clave}>{etiqueta}</option>)}<option value="disponible">Disponibles</option><option value="parida">Paridas</option><option value="perdida_aborto">Pérdidas/abortos</option></select></label>
          <label><span>Corral</span><select value={filtros.corral} onChange={(e) => cambiarFiltro('corral', e.target.value)}><option value="todos">Todos</option>{corrales.map((corral) => <option key={corral}>{corral}</option>)}</select></label>
          <label><span>Periodo</span><select value={filtros.periodo} onChange={(e) => cambiarFiltro('periodo', e.target.value)}><option value="todos">Todos</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="anio">Este año</option></select></label>
          <label><span>Toro</span><select value={filtros.toro} onChange={(e) => cambiarFiltro('toro', e.target.value)}><option value="todos">Todos</option><option value="sin-toro">Sin toro enlazado</option>{toros.map(([id, arete]) => <option key={id} value={id}>#{arete}</option>)}</select></label>
          <label><span>Próxima acción</span><select value={filtros.accion} onChange={(e) => cambiarFiltro('accion', e.target.value)}><option value="todos">Todas</option><option value="servicio">Servicio</option><option value="diagnostico">Diagnóstico o revisión</option><option value="parto">Parto o incidencia</option><option value="seguimiento">Seguimiento</option></select></label>
          <button type="button" className="btn btn-ghost" onClick={() => setFiltros({ estado: 'todos', corral: 'todos', periodo: 'todos', toro: 'todos', accion: 'todos' })}>Limpiar filtros</button>
        </div>}
        <label className="repro-search repro-herd-search"><span>Buscar vaca</span><input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Arete, nombre o corral" autoComplete="off" /></label>
        <p className="repro-results-summary">{visibles.length} de {hato.length} vacas operables</p>
        {visibles.length ? <div className="repro-field-grid">{visibles.map((fila) => <TarjetaHato key={fila.animal.id} fila={fila} onAbrirSeguimiento={onAbrirSeguimiento} />)}</div> : <EstadoVacio titulo={tituloVacio} descripcion="Cambia o limpia los filtros para revisar otro grupo." compacto />}
      </section>
      <details className="repro-secondary-module"><summary>Análisis reproductivo</summary><ReproduccionAnalitica onAbrirSeguimiento={onAbrirSeguimiento} /></details>
      {tienePermiso(usuario?.rol, 'costos_reproductivos', 'leer') && <details className="repro-secondary-module"><summary>Economía reproductiva</summary><ReproduccionEconomica /></details>}
    </>}
    </>}
  </div>;
}
