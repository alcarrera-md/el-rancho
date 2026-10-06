import { useEffect, useState } from 'react';
import { api, urlFoto } from '../api';
import EstadoSaludBadge from './EstadoSaludBadge.jsx';
import { IconoOjo } from './Iconos.jsx';
import CurvaPeso from './CurvaPeso.jsx';
import CurvaLeche from './CurvaLeche.jsx';
import { exportarFichaPDF } from '../exportUtils.js';

const ETIQUETAS_TIPO = {
  pesaje: 'Pesaje',
  salud: 'Evento de salud',
  alimentacion: 'Alimentación',
  reproduccion: 'Evento reproductivo',
  movimiento: 'Movimiento de corral',
  leche: 'Producción de leche',
  condicion: 'Condición corporal',
  categoria: 'Cambio de categoría',
};

const CATEGORIA_LABEL = {
  cria: 'Cría', destete: 'Destete', engorde: 'Engorde', vientre: 'Vientre', reproductor: 'Reproductor', descarte: 'Descarte',
};

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function DetalleEvento({ tipo, detalle }) {
  switch (tipo) {
    case 'pesaje':
      return <>Peso registrado: <strong>{detalle.peso_kg} kg</strong>{detalle.observacion ? ` — ${detalle.observacion}` : ''}</>;
    case 'salud':
      return <>{detalle.tipo}{detalle.enfermedad ? ` — ${detalle.enfermedad}` : ''}{detalle.proxima_dosis ? ` (próxima dosis: ${formatearFecha(detalle.proxima_dosis)})` : ''}</>;
    case 'alimentacion':
      return <>{detalle.cantidad} {detalle.unidad_medida} de {detalle.insumo}</>;
    case 'leche':
      return <>{detalle.litros} L {detalle.turno !== 'unico' ? `(turno ${detalle.turno === 'manana' ? 'mañana' : 'tarde'})` : ''}</>;
    case 'condicion':
      return <>Condición corporal: <strong>{detalle.puntuacion}/5</strong></>;
    case 'categoria':
      return <>{detalle.categoria_anterior ? `De "${CATEGORIA_LABEL[detalle.categoria_anterior] || detalle.categoria_anterior}" a` : 'Asignada a'} "{CATEGORIA_LABEL[detalle.categoria_nueva] || detalle.categoria_nueva}"</>;
    case 'movimiento':
      return <>{detalle.corral_origen ? `De ${detalle.corral_origen} a` : 'Ingresó a'} {detalle.corral_destino}{detalle.motivo ? ` (${detalle.motivo})` : ''}</>;
    case 'reproduccion':
      return (
        <>
          Monta {detalle.tipo_monta === 'natural' ? 'natural' : 'por inseminación artificial'}
          {detalle.fecha_parto_real
            ? ` — parto el ${formatearFecha(detalle.fecha_parto_real)} (${detalle.resultado})`
            : ` — parto estimado: ${formatearFecha(detalle.fecha_parto_estimada)}`}
        </>
      );
    default:
      return null;
  }
}

export default function AnimalFicha({ animalId, onVolver, onAbrirSeguimiento }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api.obtenerHistorial(animalId).then(setData).catch((err) => setError(err.message));
  }, [animalId]);

  if (error) return <div className="error-banner">No se pudo cargar la ficha: {error}</div>;
  if (!data) return <div className="empty-state">Cargando ficha...</div>;

  const { animal, resumen, resumen_leche, timeline, crias, venta, rentabilidad } = data;

  return (
    <div>
      <button className="btn btn-ghost" onClick={onVolver} style={{ marginBottom: 18 }}>← Volver a animales</button>

      <div className="ficha-header">
        {animal.foto_url && (
          <img
            src={urlFoto(animal.foto_url)}
            alt={animal.nombre_alias || animal.arete_id}
            style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}
          />
        )}
        <div className="ficha-tag">
          <small>Arete</small>
          <span>{animal.arete_id}</span>
        </div>
        <div className="ficha-meta">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2>{animal.nombre_alias || `Animal ${animal.arete_id}`}</h2>
            <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => exportarFichaPDF(animal, timeline)}>
              Exportar PDF
            </button>
          </div>
          <div className="meta-row">
            <span>{animal.sexo === 'hembra' ? 'Hembra' : 'Macho'}</span>
            <span>{animal.raza || 'Raza sin especificar'}</span>
            <span>Nació: {formatearFecha(animal.fecha_nacimiento)}</span>
            <span>Corral: {animal.corral_actual || '—'}</span>
            {animal.madre_arete && <span>Madre: {animal.madre_arete}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            <EstadoSaludBadge estado={animal.estado} estadoSalud={animal.estado_salud} />
            <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{CATEGORIA_LABEL[animal.categoria] || ''}</span>
            {animal.estado === 'vivo' && (
              <button className="btn btn-primary" style={{ padding: '5px 14px', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => onAbrirSeguimiento(animalId)}>
                <IconoOjo width={15} height={15} /> Entrar a seguimiento
              </button>
            )}
          </div>
        </div>
      </div>

      {venta && (
        <div className="error-banner" style={{ background: 'var(--wheat-soft)', color: '#6b4f10', borderColor: 'var(--wheat)' }}>
          Vendido el {formatearFecha(venta.fecha)} a {venta.comprador} por ${venta.precio}
        </div>
      )}

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
        {resumen_leche && (
          <>
            <div className="card resumen-item">
              <div className="valor">{Number(resumen_leche.litros_hoy)} L</div>
              <div className="etiqueta">Leche hoy</div>
            </div>
            <div className="card resumen-item">
              <div className="valor">{Number(resumen_leche.litros_semana_actual)} L</div>
              <div className="etiqueta">Leche esta semana</div>
            </div>
          </>
        )}
      </div>

      <CurvaPeso pesajes={timeline.filter((e) => e.tipo === 'pesaje').map((e) => e.detalle)} />
      {animal.sexo === 'hembra' && <CurvaLeche registros={timeline.filter((e) => e.tipo === 'leche').map((e) => e.detalle)} />}

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
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '1.3rem', fontWeight: 700,
                color: rentabilidad.neto >= 0 ? 'var(--pasture)' : 'var(--rust)',
              }}>
                ${rentabilidad.neto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: 10, marginBottom: 0 }}>
            Estimado según el costo promedio de tus compras de insumos — no es un costo exacto por evento.
          </p>
        </div>
      )}

      <div className="card" style={{ padding: '24px 28px' }}>
        <div className="section-title">Bitácora — historial completo</div>
        {timeline.length === 0 ? (
          <div className="empty-state">
            <h3>Todavía no hay eventos registrados</h3>
            <p>Entra a "seguimiento" para empezar a registrar actividad de este animal.</p>
          </div>
        ) : (
          <div className="bitacora">
            {timeline.map((evento, i) => (
              <div key={i} className={`bitacora-item tipo-${evento.tipo}`}>
                <div className="bitacora-fecha">{formatearFecha(evento.fecha)}</div>
                <div className="bitacora-titulo">{ETIQUETAS_TIPO[evento.tipo]}</div>
                <div className="bitacora-detalle">
                  <DetalleEvento tipo={evento.tipo} detalle={evento.detalle} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
