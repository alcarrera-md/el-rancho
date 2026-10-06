import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import { ACCIONES_CAMPO } from '../fieldActions.js';
import { TAREAS_MOVIMIENTOS } from '../guidedUx.js';
import CapturaRapidaModal from './CapturaRapidaModal.jsx';
import { EncabezadoDetalle, PresentacionPantalla, SelectorTarea } from './PresentacionGuiada.jsx';
import { IconoMovimiento, IconoPersonas, IconoLibro, IconoRuta, IconoUbicacion } from './Iconos.jsx';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { exigirListaModulo } from '../monitoringUx.js';
import { detalleMovimientoConfirmado, mostrarExito } from '../feedbackOperacion.js';
import { actualizarContexto, leerIdContexto } from '../navigationContext.js';
import ContextoNavegacion from './ContextoNavegacion.jsx';

const MOTIVO_LABEL = {
  ingreso_inicial: 'Ingreso inicial',
  destete: 'Destete',
  engorde: 'Engorde',
  venta: 'Venta',
  reubicacion: 'Reubicación',
  traslado: 'Traslado',
};

function formatearFecha(fecha) {
  const valor = new Date(fecha);
  const incluyeHora = typeof fecha === 'string' && fecha.includes('T');
  return valor.toLocaleString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(incluyeHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function MiniStat({ valor, etiqueta }) {
  return (
    <div className="mini-stat">
      <div className="valor">{valor ?? '—'}</div>
      <div className="etiqueta">{etiqueta}</div>
    </div>
  );
}

export default function Movimientos({ onAbrirSeguimiento }) {
  const { usuario } = useAuth();
  const [parametros, setParametros] = useSearchParams();
  const corralContextoId = leerIdContexto(parametros, 'corral');
  const puedeMover = tienePermiso(usuario?.rol, 'animales', 'editar');
  const [movimientos, setMovimientos] = useState(null);
  const [corrales, setCorrales] = useState(null);
  const [corralFiltro, setCorralFiltro] = useState(corralContextoId || '');
  const [tarea, setTarea] = useState(corralContextoId ? 'historial' : null);
  const [mostrarCaptura, setMostrarCaptura] = useState(false);
  const [errorMovimientos, setErrorMovimientos] = useState(null);
  const [errorCorrales, setErrorCorrales] = useState(null);
  const [movimientoDestacado, setMovimientoDestacado] = useState(null);

  async function cargar(params = {}, { conservar = false } = {}) {
    if (!conservar) setMovimientos(null);
    setErrorMovimientos(null);
    try {
      const data = await api.listarMovimientos(params);
      const lista = exigirListaModulo(data, '/api/corrales/movimientos');
      setMovimientos(lista);
      return lista;
    } catch (error) {
      setErrorMovimientos(error.message);
      throw error;
    }
  }

  useEffect(() => {
    setErrorCorrales(null);
    api.listarCorrales()
      .then((data) => setCorrales(exigirListaModulo(data, '/api/corrales')))
      .catch((error) => setErrorCorrales(error.message));
  }, []);

  const corralContexto = useMemo(() => (corrales || []).find((corral) => String(corral.id) === corralContextoId) || null, [corrales, corralContextoId]);

  useEffect(() => {
    if (!corrales) return;
    if (corralContextoId && corralContexto) {
      setCorralFiltro(corralContextoId);
      setTarea('historial');
    } else if (corralContextoId && !corralContexto) setCorralFiltro('');
    else setCorralFiltro('');
  }, [corrales, corralContextoId, corralContexto]);

  useEffect(() => {
    cargar(corralFiltro ? { corral_id: corralFiltro } : {}).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corralFiltro]);

  const resumenMovimientos = useMemo(() => {
    if (!movimientos) return null;
    const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
    const inicioSemana = new Date(inicioHoy); inicioSemana.setDate(inicioHoy.getDate() - ((inicioHoy.getDay() + 6) % 7));
    const hoy = movimientos.filter((m) => new Date(m.fecha) >= inicioHoy);
    const semana = movimientos.filter((m) => new Date(m.fecha) >= inicioSemana);
    return { hoy: hoy.length, semana: semana.length, animales: new Set(semana.map((m) => m.animal_id)).size };
  }, [movimientos]);

  const iconos = { individual: IconoMovimiento, varios: IconoPersonas, historial: IconoLibro };
  const tareas = TAREAS_MOVIMIENTOS
    .filter((opcion) => opcion.id === 'historial' || puedeMover)
    .map((opcion) => ({ ...opcion, icono: iconos[opcion.id] }));

  function cambiarCorral(valor) {
    setCorralFiltro(valor);
    setParametros(actualizarContexto(parametros, { corral: valor || null }), { replace: true });
  }

  function quitarContexto() {
    cambiarCorral('');
  }

  async function completarMovimiento(_mensaje, resultado) {
    setMostrarCaptura(false);
    setTarea('historial');
    const lista = await cargar(corralFiltro ? { corral_id: corralFiltro } : {}, { conservar: true }).catch(() => null);
    if (!lista) return;
    const movimiento = resultado?.movimiento;
    if (movimiento && lista.some((item) => String(item.id) === String(movimiento.id))) {
      setMovimientoDestacado(movimiento.id);
      window.setTimeout(() => setMovimientoDestacado((actual) => actual === movimiento.id ? null : actual), 4200);
    }
    mostrarExito(detalleMovimientoConfirmado(resultado?.animal, movimiento));
  }

  return (
    <div className="movements-page">
      <PresentacionPantalla
        etiqueta="Historial de recorrido"
        titulo="Cómo se ha movido el ganado"
        descripcion="Consulta de dónde salió cada animal, a qué corral llegó, cuándo ocurrió y quién realizó el traslado."
        className="movement-module-header"
        icono={IconoRuta}
        acento="movimiento"
      />
      {corrales && corralContextoId && <ContextoNavegacion etiqueta={corralContexto?.nombre || `Corral ${corralContextoId}`} descripcion={corralContexto ? 'El historial está filtrado por movimientos de entrada o salida de este corral.' : 'El corral solicitado ya no está disponible; se muestra el historial completo.'} invalido={!corralContexto} onLimpiar={quitarContexto} />}

      <section className="movement-story-banner" aria-labelledby="movement-story-title">
        <img src="/images/modules/movimientos-recorrido.jpg" alt="Ganado pasando ordenadamente de un potrero a otro a través de una puerta de corral" loading="lazy" decoding="async" />
        <div><span>Recorrido del ganado</span><h2 id="movement-story-title">Cada traslado deja un origen y un destino</h2><p>El historial conserva cuándo se movió el animal, el motivo y la persona responsable cuando está registrada.</p></div>
      </section>

      <div className="movement-task-switcher"><SelectorTarea opciones={tareas} valor={tarea} onSeleccionar={setTarea} titulo="¿Qué recorrido necesitas registrar o consultar?" descripcion="Elige una acción; solo aparecerán los controles necesarios para completarla." /></div>

      {tarea === 'individual' && (
        <section className="guided-detail-panel">
          <EncabezadoDetalle titulo="Mover un animal" descripcion="Busca por arete o alias; el sistema conservará el animal seleccionado durante el traslado." />
          <button type="button" className="btn btn-primary guided-primary-action" onClick={() => setMostrarCaptura(true)}>Buscar animal para mover</button>
        </section>
      )}

      {tarea === 'historial' && (
        <section className="guided-detail-panel">
          <EncabezadoDetalle titulo="Movimientos anteriores" descripcion="Filtra por corral o abre un animal para consultar todo su expediente." />
          <div className="movement-summary" aria-label="Resumen de movimientos">
            <div className="movement-summary-mark" aria-hidden="true"><IconoRuta width={28} height={28} /></div>
            <MiniStat valor={resumenMovimientos?.hoy ?? '—'} etiqueta="Movimientos hoy" />
            <MiniStat valor={resumenMovimientos?.semana ?? '—'} etiqueta="Esta semana" />
            <MiniStat valor={resumenMovimientos?.animales ?? '—'} etiqueta="Animales movidos" />
          </div>

          <div className="toolbar guided-toolbar">
            <label className="sr-only" htmlFor="movimientos-corral">Filtrar movimientos por corral</label>
            <select id="movimientos-corral" value={corralFiltro} onChange={(e) => cambiarCorral(e.target.value)}>
              <option value="">Todos los corrales</option>
              {(corrales || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          {errorCorrales && <EstadoError mensaje={errorCorrales} compacto />}
          {errorMovimientos && <EstadoError mensaje={errorMovimientos} compacto onReintentar={() => cargar(corralFiltro ? { corral_id: corralFiltro } : {})} />}

          <div className="movement-history-panel">
            {!movimientos && !errorMovimientos ? (
              <EstadoCarga mensaje="Cargando movimientos…" />
            ) : movimientos?.length === 0 ? (
              <EstadoVacio titulo="Sin movimientos registrados" descripcion="Los traslados confirmados aparecerán aquí." />
            ) : movimientos ? (
              <div className="movement-route-list">
                {movimientos.map((m) => (
                  <button type="button" key={m.id} className={`movement-route-card ${String(m.id) === String(movimientoDestacado) ? 'movimiento-reciente' : ''}`} onClick={() => onAbrirSeguimiento(m.animal_id)}>
                    <span className="movement-animal"><IconoMovimiento /><span><strong>{m.nombre_alias || m.arete_id}</strong><small>Arete {m.arete_id}</small></span></span>
                    <span className="movement-path">
                      <span><small>Origen</small><strong>{m.corral_origen || 'Ingreso al sistema'}</strong></span>
                      <i aria-hidden="true"><IconoRuta /></i>
                      <span><small>Destino</small><strong>{m.corral_destino}</strong></span>
                    </span>
                    <span className="movement-meta"><span><IconoUbicacion /><b>{MOTIVO_LABEL[m.motivo] || m.motivo || 'Sin motivo registrado'}</b></span><time>{formatearFecha(m.fecha)}</time><small>{m.responsable ? `Responsable: ${m.responsable}` : 'Sin responsable registrado'}</small></span>
                    <span className="movement-open">Ver animal <span aria-hidden="true">→</span></span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      )}

      {!tarea && <p className="guided-choice-hint" role="status">Elige una tarea para ver únicamente los controles que necesitas.</p>}

      {mostrarCaptura && (
        <CapturaRapidaModal
          accionInicial={ACCIONES_CAMPO.MOVER}
          onCerrar={() => setMostrarCaptura(false)}
          onCompletado={completarMovimiento}
        />
      )}
    </div>
  );
}
