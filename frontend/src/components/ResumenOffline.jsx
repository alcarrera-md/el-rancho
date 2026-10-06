import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_TAREAS, leerColeccionLocal } from '../offline/campoDB.js';
import { normalizarTarea, resumirTareas } from '../tareas.js';
import { ACCIONES_CAMPO, fechaLocalISO } from '../fieldActions.js';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import ModuleHeader from './ModuleHeader.jsx';
import { IconoAnimal, IconoBalanza, IconoCampana, IconoChat } from './Iconos.jsx';
import IndicadorDatosLocales from './IndicadorDatosLocales.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import { IconoHoja, IconoMovimiento, IconoSincronizacion } from './Iconos.jsx';
import { obtenerEstadoCola, suscribirColaOffline } from '../offline/colaOperaciones.js';

// Offline v1 Fase B §8 — Inicio sin conexión: un resumen REDUCIDO
// construido solo con lo que realmente está en el bootstrap (ganado,
// corrales, tareas). A propósito no intenta reproducir el Dashboard
// completo: nunca inventa alertas frescas, clima ni ningún dato que no
// esté en el snapshot local — por eso es un componente aparte en vez de
// una rama condicional dentro de Dashboard.jsx.
export default function ResumenOffline({ onCapturaRapida, onIrSincronizacion }) {
  const { usuario } = useAuth();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    let vigente = true;
    if (!usuario?.id) return undefined;
    setDatos(null);
    setError('');
    Promise.all([
      leerColeccionLocal(ALMACEN_ANIMALES, usuario.id),
      leerColeccionLocal(ALMACEN_CORRALES, usuario.id),
      leerColeccionLocal(ALMACEN_TAREAS, usuario.id),
    ]).then(([animales, corrales, tareas]) => {
      if (vigente) setDatos({ animales: animales?.datos || [], corrales: corrales?.datos || [], tareas: tareas?.datos || [], sincronizadoEn: animales?.sincronizado_en || null });
    }).catch(() => {
      if (vigente) setError('No se pudo leer el resumen guardado. Conéctate a Internet para volver a sincronizarlo.');
    });
    return () => { vigente = false; };
  }, [usuario?.id]);

  useEffect(() => {
    if (!usuario?.id) return undefined;
    const cargar = () => obtenerEstadoCola(usuario.id).then((estado) => setPendientes(estado.pendientes + estado.errores + estado.conflictos.length)).catch(() => {});
    void cargar();
    return suscribirColaOffline(usuario.id, cargar);
  }, [usuario?.id]);

  if (error) return <EstadoError mensaje={error} />;
  if (!datos) return <EstadoCarga mensaje="Cargando resumen guardado en este dispositivo…" />;

  const animalesVivos = datos.animales.filter((a) => !a.estado || a.estado === 'vivo').length;
  const capacidadTotal = datos.corrales.reduce((total, c) => total + (Number(c.capacidad_maxima) || 0), 0);
  const ocupacionTotal = datos.corrales.reduce((total, c) => total + (Number(c.ocupacion_actual ?? c.animales_activos) || 0), 0);
  const hoy = fechaLocalISO();
  const resumenTareas = resumirTareas(datos.tareas.map(normalizarTarea), hoy);
  const sinDatos = datos.animales.length === 0 && datos.corrales.length === 0 && datos.tareas.length === 0;
  const puedePesaje = tienePermiso(usuario?.rol, 'pesajes', 'crear');
  const puedeObservacion = tienePermiso(usuario?.rol, 'animales', 'reportar_observacion');
  const puedeNota = tienePermiso(usuario?.rol, 'notas_seguimiento', 'crear');
  const puedeAlimentacion = tienePermiso(usuario?.rol, 'alimentacion', 'crear');
  const puedeMover = tienePermiso(usuario?.rol, 'animales', 'editar');
  const hayCapturas = puedePesaje || puedeObservacion || puedeNota || puedeAlimentacion || puedeMover;

  return (
    <div>
      <ModuleHeader
        eyebrow="Sin conexión"
        title="Resumen guardado en este dispositivo"
        description="Ganado, corrales y tareas de la última sincronización. No incluye alertas ni clima: esos requieren conexión."
        icon={IconoAnimal}
        accent="animal"
      />
      <IndicadorDatosLocales sincronizadoEn={datos.sincronizadoEn} />
      {sinDatos ? (
        <div className="card"><EstadoVacio titulo="Todavía no hay información sincronizada" descripcion="Conéctate a Internet al menos una vez para poder consultar este resumen sin conexión." /></div>
      ) : (
        <div className="card">
          <div className="task-stats">
            <div><strong>{animalesVivos}</strong><span>Animales vivos</span></div>
            <div><strong>{datos.corrales.length}</strong><span>Corrales</span></div>
            <div><strong>{capacidadTotal ? `${ocupacionTotal}/${capacidadTotal}` : ocupacionTotal}</strong><span>Ocupación</span></div>
            <div className={resumenTareas.vencidas ? 'alerta' : ''}><strong>{resumenTareas.vencidas}</strong><span>Tareas vencidas</span></div>
            <div><strong>{resumenTareas.pendientes}</strong><span>Tareas pendientes</span></div>
            <div className={pendientes ? 'alerta' : ''}><strong>{pendientes}</strong><span>Capturas pendientes</span></div>
          </div>
        </div>
      )}
      {!sinDatos && onCapturaRapida && hayCapturas && (
        <section className="card offline-capture-actions" aria-labelledby="capturas-offline">
          <div><h2 id="capturas-offline">Registrar trabajo sin conexión</h2><p>Estas capturas quedarán pendientes y se enviarán después de validar tu sesión al recuperar Internet.</p></div>
          <div className="offline-capture-grid">
            {puedePesaje && <button type="button" className="quick-action-row" onClick={() => onCapturaRapida(ACCIONES_CAMPO.PESAJE)}><IconoBalanza /><span><strong>Registrar pesaje</strong><small>Guarda peso, fecha y observación.</small></span><b aria-hidden="true">›</b></button>}
            {puedeObservacion && <button type="button" className="quick-action-row" onClick={() => onCapturaRapida(ACCIONES_CAMPO.OBSERVACION)}><IconoCampana /><span><strong>Reportar revisión</strong><small>Marca un animal para atención clínica.</small></span><b aria-hidden="true">›</b></button>}
            {puedeNota && <button type="button" className="quick-action-row" onClick={() => onCapturaRapida(ACCIONES_CAMPO.NOTA)}><IconoChat /><span><strong>Agregar nota</strong><small>Conserva una observación de seguimiento.</small></span><b aria-hidden="true">›</b></button>}
            {puedeAlimentacion && <button type="button" className="quick-action-row" onClick={() => onCapturaRapida(ACCIONES_CAMPO.ALIMENTACION)}><IconoHoja /><span><strong>Registrar alimentación</strong><small>Usa alimento y stock sincronizados.</small></span><b aria-hidden="true">›</b></button>}
            {puedeMover && <button type="button" className="quick-action-row" onClick={() => onCapturaRapida(ACCIONES_CAMPO.MOVER)}><IconoMovimiento /><span><strong>Registrar movimiento</strong><small>Usa corrales y capacidad sincronizados.</small></span><b aria-hidden="true">›</b></button>}
            {onIrSincronizacion && <button type="button" className="quick-action-row" onClick={onIrSincronizacion}><IconoSincronizacion /><span><strong>Revisar sincronización</strong><small>{pendientes ? `${pendientes} captura${pendientes === 1 ? '' : 's'} necesita${pendientes === 1 ? '' : 'n'} atención.` : 'No hay capturas pendientes.'}</small></span><b aria-hidden="true">›</b></button>}
          </div>
        </section>
      )}
    </div>
  );
}
