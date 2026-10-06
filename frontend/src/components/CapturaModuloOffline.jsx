import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { ACCIONES_CAMPO } from '../fieldActions.js';
import {
  ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_INSUMOS, leerColeccionLocal, listarOperacionesLocal,
} from '../offline/campoDB.js';
import CapturaRapidaModal from './CapturaRapidaModal.jsx';
import IndicadorDatosLocales from './IndicadorDatosLocales.jsx';
import ModuleHeader from './ModuleHeader.jsx';
import { EstadoCarga, EstadoError, EstadoVacio, FeedbackOperacion } from './EstadosUI.jsx';
import { IconoBalanza, IconoHoja, IconoMovimiento } from './Iconos.jsx';
import { alimentacionPendientePorInsumo } from '../offline/fichaOffline.js';
import { tienePermiso } from '../authorization/permissions.js';

const CONFIG = Object.freeze({
  pesajes: {
    accion: ACCIONES_CAMPO.PESAJE, eyebrow: 'Modo offline limitado', titulo: 'Registrar pesaje',
    descripcion: 'Selecciona un animal sincronizado y guarda el pesaje en este dispositivo.', icono: IconoBalanza, permiso: ['pesajes', 'crear'],
  },
  alimentacion: {
    accion: ACCIONES_CAMPO.ALIMENTACION, eyebrow: 'Modo offline limitado', titulo: 'Registrar alimentación',
    descripcion: 'Usa el catálogo y stock de la última sincronización. Se revalidarán al enviar.', icono: IconoHoja, permiso: ['alimentacion', 'crear'],
  },
  movimientos: {
    accion: ACCIONES_CAMPO.MOVER, eyebrow: 'Modo offline limitado', titulo: 'Registrar movimiento',
    descripcion: 'Selecciona un animal y un destino guardados. La versión y capacidad se revalidarán al enviar.', icono: IconoMovimiento, permiso: ['animales', 'editar'],
  },
});

export default function CapturaModuloOffline({ modulo }) {
  const { usuario } = useAuth();
  const config = CONFIG[modulo];
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [capturando, setCapturando] = useState(false);
  const [confirmacion, setConfirmacion] = useState('');

  useEffect(() => {
    let vigente = true;
    setError('');
    Promise.all([
      leerColeccionLocal(ALMACEN_ANIMALES, usuario?.id),
      leerColeccionLocal(ALMACEN_CORRALES, usuario?.id),
      leerColeccionLocal(ALMACEN_INSUMOS, usuario?.id),
      listarOperacionesLocal(usuario?.id),
    ]).then(([animales, corrales, insumos, operaciones]) => {
      if (vigente) setDatos({
        animales: (animales?.datos || []).filter((animal) => animal.estado === 'vivo'),
        corrales: corrales?.datos || [], insumos: insumos?.datos || [],
        pendientesAlimento: alimentacionPendientePorInsumo(operaciones),
        sincronizadoEn: animales?.sincronizado_en || corrales?.sincronizado_en || insumos?.sincronizado_en || null,
      });
    }).catch(() => { if (vigente) setError('No se pudo leer la información sincronizada de este dispositivo.'); });
    return () => { vigente = false; };
  }, [usuario?.id, confirmacion]);

  if (!config) return <EstadoError mensaje="Este módulo offline no está disponible." />;
  const puedeCapturar = tienePermiso(usuario?.rol, config.permiso[0], config.permiso[1]);
  return (
    <div className="offline-limited-page">
      <ModuleHeader eyebrow={config.eyebrow} title={config.titulo} description={config.descripcion} icon={config.icono} accent="campo" />
      {datos && <IndicadorDatosLocales sincronizadoEn={datos.sincronizadoEn} />}
      {error && <EstadoError mensaje={error} />}
      {!datos && !error ? <EstadoCarga mensaje="Leyendo datos guardados…" /> : datos && (
        <>
          <section className="card offline-limited-summary" aria-label="Información disponible sin conexión">
            <div><strong>{datos.animales.length}</strong><span>Animales disponibles</span></div>
            {modulo === 'alimentacion' && <div><strong>{datos.insumos.length}</strong><span>Alimentos sincronizados</span></div>}
            {modulo === 'movimientos' && <div><strong>{datos.corrales.length}</strong><span>Corrales sincronizados</span></div>}
          </section>

          {modulo === 'alimentacion' && (
            <section className="card offline-snapshot-list"><h2>Stock según última sincronización</h2>
              {datos.insumos.length ? datos.insumos.map((insumo) => {
                const pendiente = datos.pendientesAlimento?.get(String(insumo.id));
                return <div key={insumo.id}><span>{insumo.nombre}{pendiente && <small className="alimento-pendiente">{pendiente.cantidad} {pendiente.unidad || insumo.unidad_medida} pendientes de sincronización</small>}</span><strong>{insumo.stock_actual} {insumo.unidad_medida}</strong></div>;
              }) : <EstadoVacio titulo="No hay alimentos sincronizados" compacto />}
            </section>
          )}
          {modulo === 'movimientos' && (
            <section className="card offline-snapshot-list"><h2>Capacidad observada</h2>
              {datos.corrales.length ? datos.corrales.map((corral) => <div key={corral.id}><span>{corral.nombre}</span><strong>{corral.ocupacion_actual}/{corral.capacidad_maxima}</strong></div>) : <EstadoVacio titulo="No hay corrales sincronizados" compacto />}
            </section>
          )}

          <FeedbackOperacion mensaje={confirmacion} />
          {puedeCapturar
            ? <button type="button" className="btn btn-primary offline-limited-primary" onClick={() => setCapturando(true)} disabled={!datos.animales.length}>{config.titulo}</button>
            : <p className="offline-action-help">Tu rol puede consultar estos datos, pero no registrar esta operación.</p>}
          <section className="card offline-unavailable"><h2>Disponible al recuperar conexión</h2><p>El historial completo, edición y funciones administrativas requieren Internet.</p></section>
        </>
      )}
      {capturando && <CapturaRapidaModal accionInicial={config.accion} onCerrar={() => setCapturando(false)} onCompletado={(mensaje) => { setCapturando(false); setConfirmacion(mensaje); }} />}
    </div>
  );
}
