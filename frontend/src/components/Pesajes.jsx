import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { EncabezadoDetalle, PresentacionPantalla, SelectorDetalle } from './PresentacionGuiada.jsx';
import ContextoNavegacion from './ContextoNavegacion.jsx';
import { actualizarContexto, leerIdContexto } from '../navigationContext.js';
import { IconoBalanza } from './Iconos.jsx';

const COLORES_ANIMAL = ['#2f5233', '#c99a2e', '#a8412c', '#3b6ea5', '#6d4a94', '#5b6b5f', '#7a9e7e', '#d9b96a'];
const MAX_COMPARACION = 6;

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatearFechaCorta(ts) {
  return new Date(ts).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
}

function MiniStat({ valor, etiqueta, tono }) {
  return (
    <div className="mini-stat">
      <div className="valor" style={tono ? { color: `var(--${tono})` } : undefined}>{valor ?? '—'}</div>
      <div className="etiqueta">{etiqueta}</div>
    </div>
  );
}

function FlechaOrden({ activo, dir }) {
  if (!activo) return null;
  return <span style={{ marginLeft: 4 }}>{dir === 'desc' ? '↓' : '↑'}</span>;
}

export default function Pesajes({ onAbrirSeguimiento }) {
  const [parametros, setParametros] = useSearchParams();
  const corralContextoId = leerIdContexto(parametros, 'corral');
  const [actual, setActual] = useState(null);
  const [evolucion, setEvolucion] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [corrales, setCorrales] = useState(null);
  const [orden, setOrden] = useState({ campo: 'ultimo_peso', dir: 'desc' });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [comparacion, setComparacion] = useState(null);
  const [comparando, setComparando] = useState(false);
  const [vista, setVista] = useState(corralContextoId ? 'animales' : 'panorama');
  const [error, setError] = useState(null);

  function cargar() {
    setError(null);
    return Promise.all([api.pesajesActual(), api.pesajesEvolucion(), api.reporteResumen(), api.listarCorrales()])
      .then(([actuales, evolucionHato, resumenHato, corralesDisponibles]) => {
        setActual(actuales); setEvolucion(evolucionHato); setResumen(resumenHato); setCorrales(corralesDisponibles);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function ordenarPor(campo) {
    setOrden((o) => ({ campo, dir: o.campo === campo && o.dir === 'desc' ? 'asc' : 'desc' }));
  }

  const filasOrdenadas = useMemo(() => {
    if (!actual) return [];
    const corral = (corrales || []).find((item) => String(item.id) === corralContextoId);
    const copia = corral ? actual.filter((animal) => animal.corral === corral.nombre) : [...actual];
    copia.sort((a, b) => {
      const va = a[orden.campo] === null || a[orden.campo] === undefined ? -Infinity : Number(a[orden.campo]);
      const vb = b[orden.campo] === null || b[orden.campo] === undefined ? -Infinity : Number(b[orden.campo]);
      return orden.dir === 'desc' ? vb - va : va - vb;
    });
    return copia;
  }, [actual, orden, corrales, corralContextoId]);

  const corralContexto = useMemo(() => (corrales || []).find((corral) => String(corral.id) === corralContextoId) || null, [corrales, corralContextoId]);

  useEffect(() => {
    if (corralContextoId && corralContexto) setVista('animales');
  }, [corralContextoId, corralContexto]);

  function quitarContexto() {
    setParametros(actualizarContexto(parametros, { corral: null }), { replace: true });
  }

  function alternarSeleccion(id) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else if (nuevo.size < MAX_COMPARACION) nuevo.add(id);
      return nuevo;
    });
  }

  async function compararSeleccionados() {
    if (seleccionados.size === 0) return;
    setComparando(true);
    try {
      const data = await api.compararPesajes([...seleccionados]);
      setComparacion(data);
    } catch (err) {
      setComparacion(null);
      setError(err.message);
    } finally {
      setComparando(false);
    }
  }

  const sinPesajeReciente = (actual || []).filter((a) => !a.ultimo_peso).length;
  const tendenciaPeso = useMemo(() => {
    if (!evolucion || evolucion.length < 2) return null;
    const primero = Number(evolucion[0].peso_promedio);
    const ultimo = Number(evolucion[evolucion.length - 1].peso_promedio);
    if (!Number.isFinite(primero) || !Number.isFinite(ultimo)) return null;
    const cambio = ultimo - primero;
    return { cambio, direccion: cambio > 0 ? 'sube' : cambio < 0 ? 'baja' : 'estable' };
  }, [evolucion]);

  return (
    <div>
      <PresentacionPantalla
        etiqueta="Control productivo"
        titulo="Evolución del peso"
        descripcion="Consulta la evolución del hato, detecta animales sin pesaje y compara su crecimiento sin perder el panorama general."
        icono={IconoBalanza}
        acento="tecnico"
      />
      {corrales && corralContextoId && <ContextoNavegacion etiqueta={corralContexto?.nombre || `Corral ${corralContextoId}`} descripcion={corralContexto ? 'La vista por animal muestra únicamente integrantes actuales de este corral.' : 'El corral solicitado ya no está disponible; se muestran todos los animales.'} invalido={!corralContexto} onLimpiar={quitarContexto} />}

      {error && <EstadoError mensaje={error} onReintentar={cargar} />}

      <div className="weight-overview">
        <div><span>Lectura rápida</span><h2>Panorama de pesajes</h2><p>{tendenciaPeso ? `El promedio ${tendenciaPeso.direccion === 'sube' ? 'subió' : tendenciaPeso.direccion === 'baja' ? 'bajó' : 'se mantuvo'} ${Math.abs(tendenciaPeso.cambio).toFixed(1)} kg en el periodo visible.` : 'Registra al menos dos periodos para interpretar la tendencia.'}</p></div>
        <div className="mini-stats">
            <MiniStat valor={resumen?.peso_promedio_kg ? `${resumen.peso_promedio_kg} kg` : '—'} etiqueta="Peso promedio del hato" />
            <MiniStat valor={resumen?.ganancia_diaria_promedio_kg ? `${resumen.ganancia_diaria_promedio_kg} kg/día` : '—'} etiqueta="Ganancia diaria promedio" />
            <MiniStat valor={sinPesajeReciente} etiqueta="Sin ningún pesaje" tono={sinPesajeReciente ? 'wheat' : undefined} />
        </div>
      </div>

      <EncabezadoDetalle titulo="¿Qué deseas revisar?" descripcion="Cambia de vista para mostrar solo el nivel de detalle que necesitas." paso="Detalle" />
      <SelectorDetalle
        valor={vista}
        onSeleccionar={setVista}
        opciones={[
          { id: 'panorama', etiqueta: 'Panorama' },
          { id: 'animales', etiqueta: 'Por animal', contador: actual?.length },
          { id: 'comparar', etiqueta: 'Comparar', contador: seleccionados.size },
        ]}
      />

      {vista === 'panorama' && <div className="module-detail">
      <div className="weight-section-heading"><div><span>Tendencia</span><h2>Evolución del promedio del hato</h2><p>La línea resume si el peso promedio está avanzando o retrocediendo.</p></div>{tendenciaPeso && <span className={`weight-trend trend-${tendenciaPeso.direccion}`}>{tendenciaPeso.direccion === 'sube' ? '↑' : tendenciaPeso.direccion === 'baja' ? '↓' : '→'} {Math.abs(tendenciaPeso.cambio).toFixed(1)} kg</span>}</div>
      <div className="card weight-chart-card">
        {!evolucion ? (
          <EstadoCarga mensaje="Cargando evolución de peso…" />
        ) : evolucion.length < 2 ? (
          <EstadoVacio titulo="Todavía no hay una tendencia visible" descripcion="Se necesitan al menos dos periodos con pesajes para trazar la evolución." compacto />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={evolucion} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'var(--ink-soft)' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'var(--ink-soft)' }} unit=" kg" width={60} />
              <Tooltip
                formatter={(value) => [`${value} kg`, 'Peso promedio']}
                contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', borderRadius: 8, border: '1px solid var(--line)' }}
              />
              <Line type="monotone" dataKey="peso_promedio" stroke="var(--pasture)" strokeWidth={3} dot={{ fill: '#fff', stroke: 'var(--pasture)', strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="weight-section-heading"><div><span>Lotes</span><h2>Peso promedio por corral</h2><p>Compara los lotes sin mezclar animales individuales.</p></div></div>
      <div className="weight-lot-panel">
        {!resumen ? (
          <EstadoCarga mensaje="Calculando promedios por corral…" />
        ) : resumen.peso_promedio_por_corral.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}><h3 style={{ fontSize: '0.95rem' }}>Sin datos de peso por lote todavía</h3></div>
        ) : resumen.peso_promedio_por_corral.map((c) => <article className="weight-lot-card" key={c.corral}><span>Corral</span><h3>{c.corral}</h3><strong>{c.peso_promedio} kg</strong><small>{c.animales} animal{Number(c.animales) === 1 ? '' : 'es'} con datos</small></article>)}
      </div>
      </div>}

      {vista === 'animales' && <div className="module-detail">
      <div className="section-title">Peso actual y ganancia diaria por animal</div>
      <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: -8, marginBottom: 14 }}>
        Marca hasta {MAX_COMPARACION} animales para compararlos en la gráfica de abajo. Haz clic en un encabezado para ordenar.
      </p>
      <div className="card" style={{ padding: '10px 0', marginBottom: 24 }}>
        {!actual ? (
          <EstadoCarga mensaje="Cargando peso por animal…" />
        ) : filasOrdenadas.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay animales con información de peso" descripcion="Los animales aparecerán aquí cuando existan datos para consultar." />
        ) : (
          <table className="animal-table responsive-cards">
            <thead>
              <tr>
                <th></th>
                <th>Arete</th>
                <th>Corral</th>
                <th><button className="table-sort-button" onClick={() => ordenarPor('ultimo_peso')}>Peso actual<FlechaOrden activo={orden.campo === 'ultimo_peso'} dir={orden.dir} /></button></th>
                <th>Fecha</th>
                <th><button className="table-sort-button" onClick={() => ordenarPor('ganancia_diaria_kg')}>Ganancia diaria<FlechaOrden activo={orden.campo === 'ganancia_diaria_kg'} dir={orden.dir} /></button></th>
              </tr>
            </thead>
            <tbody>
              {filasOrdenadas.map((a) => (
                <tr key={a.animal_id}>
                  <td data-label="Comparar" onClick={(e) => e.stopPropagation()}>
                    <input aria-label={`Seleccionar ${a.arete_id} para comparar`} type="checkbox" checked={seleccionados.has(a.animal_id)} onChange={() => alternarSeleccion(a.animal_id)} />
                  </td>
                  <td data-label="Animal"><button className="btn btn-ghost btn-table-action" onClick={() => onAbrirSeguimiento(a.animal_id)}><span className="tag-badge">{a.arete_id}</span> {a.nombre_alias || 'Ver animal'}</button></td>
                  <td data-label="Corral" style={{ color: 'var(--ink-soft)' }}>{a.corral || 'Sin lote'}</td>
                  <td data-label="Peso actual">{a.ultimo_peso ? `${a.ultimo_peso} kg` : '—'}</td>
                  <td data-label="Fecha" style={{ color: 'var(--ink-soft)' }}>{formatearFecha(a.fecha_ultimo_peso)}</td>
                  <td data-label="Ganancia diaria" style={{ color: a.ganancia_diaria_kg > 0 ? 'var(--pasture)' : a.ganancia_diaria_kg < 0 ? 'var(--rust)' : 'inherit' }}>
                    {a.ganancia_diaria_kg !== null ? `${a.ganancia_diaria_kg} kg/día` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <button className="btn btn-primary" onClick={() => setVista('comparar')} disabled={seleccionados.size === 0}>Comparar selección ({seleccionados.size})</button>
      </div>}

      {vista === 'comparar' && <div className="module-detail">
      <div className="section-title">Comparación entre animales</div>
      <div className="card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{seleccionados.size} de {MAX_COMPARACION} animales seleccionados</span>
          <button className="btn btn-primary" onClick={compararSeleccionados} disabled={seleccionados.size === 0 || comparando}>
            {comparando ? 'Comparando...' : 'Comparar seleccionados'}
          </button>
        </div>
        {!comparacion ? (
          <EstadoVacio titulo="Elige los animales que deseas comparar" descripcion="Abre la vista Por animal, marca hasta seis y vuelve aquí para generar la gráfica." accion={<button className="btn btn-primary" onClick={() => setVista('animales')}>Elegir animales</button>} />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatearFechaCorta} tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} unit=" kg" width={60} />
              <Tooltip
                labelFormatter={(ts) => formatearFechaCorta(ts)}
                formatter={(value, name) => [`${value} kg`, name]}
                contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', borderRadius: 8, border: '1px solid var(--line)' }}
              />
              <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
              {comparacion.map((serie, i) => (
                <Line
                  key={serie.animal_id}
                  data={serie.pesajes.map((p) => ({ ts: new Date(p.fecha).getTime(), peso: Number(p.peso_kg) }))}
                  dataKey="peso"
                  name={serie.nombre_alias || serie.arete_id}
                  stroke={COLORES_ANIMAL[i % COLORES_ANIMAL.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  type="monotone"
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      </div>}
    </div>
  );
}
