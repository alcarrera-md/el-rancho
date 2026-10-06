import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useModulos } from '../context/ModulosContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import {
  IconoCampana, IconoCapas, IconoEngranaje, IconoOjo, IconoPersona, IconoReportes, IconoSincronizacion,
} from './Iconos.jsx';
import AparienciaPanel from './AparienciaPanel.jsx';
import SincronizacionConfiguracion from './SincronizacionConfiguracion.jsx';
import BotonVolver from './BotonVolver.jsx';
import { EstadoCarga, EstadoError, EstadoVacio, FeedbackOperacion } from './EstadosUI.jsx';
import ModuleHeader from './ModuleHeader.jsx';

const SECCIONES = [
  { id: 'apariencia', titulo: 'Apariencia', subtitulo: 'Tema, colores, texto, densidad y contraste', Icono: IconoOjo, destino: '/configuracion/apariencia' },
  { id: 'cuenta', titulo: 'Cuenta y seguridad', subtitulo: 'Perfil, acceso personal y cambio de contraseña', Icono: IconoPersona, destino: '/perfil' },
  { id: 'sincronizacion', titulo: 'Sincronización y modo offline', subtitulo: 'Conexión, capturas pendientes y datos del dispositivo', Icono: IconoSincronizacion, destino: '/configuracion/sincronizacion' },
  { id: 'sistema', titulo: 'Sistema', subtitulo: 'Umbrales operativos y reglas configurables', Icono: IconoEngranaje, destino: '/configuracion/sistema' },
  { id: 'datos', titulo: 'Datos y respaldo', subtitulo: 'Estado de conservación y opciones de exportación', Icono: IconoReportes, destino: '/configuracion/datos' },
  { id: 'notificaciones', titulo: 'Notificaciones', subtitulo: 'Destinatarios del corte diario y avisos', Icono: IconoCampana, destino: '/configuracion/notificaciones' },
  { id: 'avanzado', titulo: 'Avanzado', subtitulo: 'Disponibilidad de módulos del sistema', Icono: IconoCapas, destino: '/configuracion/avanzado' },
];

function CentroConfiguracion({ navegar }) {
  return (
    <div className="settings-page">
      <ModuleHeader eyebrow="Preferencias del sistema" title="Ajusta El Rancho a tu forma de trabajar" description="Elige una categoría para encontrar el ajuste que necesitas." icon={IconoEngranaje} />
      <div className="settings-list">
        {SECCIONES.map(({ id, titulo, subtitulo, Icono, destino }) => (
          <button type="button" key={id} className="settings-row" onClick={() => navegar(destino)}>
            <span className={`settings-icon settings-icon-${id}`}><Icono width={22} height={22} /></span>
            <span className="settings-copy"><strong>{titulo}</strong><small>{subtitulo}</small></span>
            <span className="settings-chevron" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      <p className="settings-footnote">Los ajustes personales de apariencia se guardan en este dispositivo. Los ajustes operativos permanecen protegidos por rol.</p>
    </div>
  );
}

function EncabezadoSeccion({ titulo, descripcion }) {
  return <div className="settings-section-heading"><span>Configuración</span><h1>{titulo}</h1><p>{descripcion}</p></div>;
}

function SistemaPanel() {
  const { usuario } = useAuth();
  const puedeEditar = tienePermiso(usuario?.rol, 'configuracion', 'editar');
  const [config, setConfig] = useState(null);
  const [valores, setValores] = useState({});
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function cargar() {
    setError(null);
    api.obtenerConfiguracion().then((data) => {
      setConfig(data);
      setValores(Object.fromEntries(data.map((item) => [item.clave, item.valor])));
    }).catch((err) => setError(err.message));
  }
  useEffect(() => { cargar(); }, []);

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true); setError(null); setMensaje(null);
    try {
      await api.actualizarConfiguracion(valores);
      setMensaje('Configuración del sistema actualizada.');
      cargar();
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  }

  function limitesCampo(clave) {
    if (clave === 'ubicacion_lat') return { min: -90, max: 90, step: 0.0001 };
    if (clave === 'ubicacion_lon') return { min: -180, max: 180, step: 0.0001 };
    return { step: 0.1 };
  }

  return <><EncabezadoSeccion titulo="Sistema" descripcion="Reglas operativas que alimentan alertas, recomendaciones y seguridad." />
    {error && <EstadoError mensaje={error} onReintentar={cargar} />}<FeedbackOperacion mensaje={mensaje} />
    {!config ? <EstadoCarga mensaje="Cargando ajustes del sistema…" /> : <form onSubmit={guardar} className="card settings-form">
      {config.map((item) => <div className="field settings-field" key={item.clave}><label htmlFor={`config-${item.clave}`}>{item.descripcion}</label>{puedeEditar ? <input id={`config-${item.clave}`} className="input" type="number" {...limitesCampo(item.clave)} value={valores[item.clave] ?? ''} onChange={(e) => setValores((actual) => ({ ...actual, [item.clave]: e.target.value }))} /> : <strong>{valores[item.clave] ?? '—'}</strong>}</div>)}
      {puedeEditar && <div className="settings-actions"><button className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button></div>}
    </form>}
  </>;
}

function NotificacionesPanel() {
  const { usuario } = useAuth();
  const puedeAdministrar = tienePermiso(usuario?.rol, 'corte_diario_destinatarios', 'leer');
  const [destinatarios, setDestinatarios] = useState(null);
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  function cargar() { if (puedeAdministrar) api.obtenerDestinatariosCorte().then(setDestinatarios).catch((err) => setError(err.message)); }
  useEffect(() => { cargar(); }, [puedeAdministrar]);
  async function agregar(evento) { evento.preventDefault(); setGuardando(true); setError(null); try { await api.agregarDestinatarioCorte(correo.trim()); setCorreo(''); cargar(); } catch (err) { setError(err.message); } finally { setGuardando(false); } }
  async function quitar(id) { setError(null); try { await api.eliminarDestinatarioCorte(id); cargar(); } catch (err) { setError(err.message); } }
  return <><EncabezadoSeccion titulo="Notificaciones" descripcion="Controla quién recibe el resumen diario de actividad." />
    {!puedeAdministrar ? <div className="card settings-info-card"><IconoCampana /><div><h2>Notificaciones protegidas</h2><p>Tu rol puede consultar la configuración, pero solo Administración gestiona destinatarios.</p></div></div> : <div className="card settings-form">
      {error && <EstadoError mensaje={error} onReintentar={cargar} />}
      {!destinatarios ? <EstadoCarga mensaje="Cargando destinatarios…" /> : destinatarios.length === 0 ? <EstadoVacio titulo="Sin destinatarios adicionales" descripcion="Los administradores activos continúan recibiendo el corte." compacto /> : <div className="settings-recipient-list">{destinatarios.map((item) => <div key={item.id}><span>{item.email}</span><button className="btn btn-ghost" onClick={() => quitar(item.id)}>Quitar</button></div>)}</div>}
      <form onSubmit={agregar} className="settings-inline-form"><label className="sr-only" htmlFor="correo-corte">Correo adicional</label><input id="correo-corte" className="input" type="email" placeholder="correo@ejemplo.com" value={correo} onChange={(e) => setCorreo(e.target.value)} required /><button className="btn btn-primary" disabled={guardando}>{guardando ? 'Agregando…' : 'Agregar'}</button></form>
    </div>}
  </>;
}

function AvanzadoPanel() {
  const { usuario } = useAuth();
  const { modulos, refrescar, error } = useModulos() || {};
  const puedeEditar = tienePermiso(usuario?.rol, 'modulos', 'editar');
  const [valores, setValores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  useEffect(() => { if (modulos) setValores(Object.fromEntries(modulos.map((item) => [item.clave, item.activo]))); }, [modulos]);
  async function guardar() { setGuardando(true); setMensaje(null); try { await api.actualizarModulos(valores); await refrescar(); setMensaje('Disponibilidad de módulos actualizada.'); } catch (err) { setMensaje(`Error: ${err.message}`); } finally { setGuardando(false); } }
  return <><EncabezadoSeccion titulo="Avanzado" descripcion="Activa o pausa módulos sin borrar información." /><FeedbackOperacion tipo={mensaje?.startsWith('Error') ? 'error' : 'exito'} mensaje={mensaje} />
    <div className="card settings-form">{!modulos ? error ? <EstadoError mensaje={error} onReintentar={refrescar} /> : <EstadoCarga mensaje="Cargando módulos…" /> : <div className="settings-module-list">{modulos.map((item) => <label key={item.clave}><span><strong>{item.nombre}</strong><small>{valores[item.clave] ? 'Disponible en navegación' : 'Oculto temporalmente'}</small></span><input type="checkbox" checked={Boolean(valores[item.clave])} disabled={!puedeEditar} onChange={() => setValores((actual) => ({ ...actual, [item.clave]: !actual[item.clave] }))} /></label>)}</div>}{puedeEditar && <div className="settings-actions"><button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar módulos'}</button></div>}</div>
  </>;
}

function DatosPanel({ navegar }) {
  return <><EncabezadoSeccion titulo="Datos y respaldo" descripcion="Consulta cómo se conserva la información y prepara copias exportables." /><div className="settings-data-grid"><div className="card settings-info-card"><IconoReportes /><div><h2>Datos centralizados</h2><p>La información operativa permanece en PostgreSQL; la PWA no guarda animales, finanzas ni usuarios en caché.</p></div></div><div className="card settings-info-card"><IconoCapas /><div><h2>Exportaciones disponibles</h2><p>Genera reportes y consulta la bitácora para conservar evidencia fuera del sistema.</p><div className="settings-card-actions"><button className="btn btn-primary" onClick={() => navegar('/reportes')}>Abrir reportes</button><button className="btn btn-ghost" onClick={() => navegar('/bitacora')}>Ver bitácora</button></div></div></div></div></>;
}

export default function ConfiguracionPanel({ seccion: seccionProp }) {
  const { seccion: seccionRuta } = useParams();
  const navegar = useNavigate();
  const seccion = seccionProp || seccionRuta;
  if (!seccion) return <CentroConfiguracion navegar={navegar} />;
  const contenido = seccion === 'apariencia' ? <AparienciaPanel /> : seccion === 'sincronizacion' ? <><EncabezadoSeccion titulo="Sincronización y modo offline" descripcion="Consulta qué información está guardada en este dispositivo y cuándo llegó a El Rancho." /><SincronizacionConfiguracion /></> : seccion === 'sistema' ? <SistemaPanel /> : seccion === 'datos' ? <DatosPanel navegar={navegar} /> : seccion === 'notificaciones' ? <NotificacionesPanel /> : seccion === 'avanzado' ? <AvanzadoPanel /> : null;
  return <div className="settings-subpage"><BotonVolver destino="/configuracion" etiqueta="Configuración" />{contenido || <EstadoError mensaje="Esta sección de configuración no existe." onReintentar={() => navegar('/configuracion')} />}</div>;
}
