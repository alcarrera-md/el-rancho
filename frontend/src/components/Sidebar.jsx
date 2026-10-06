import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { useAlertas } from '../context/AlertasContext.jsx';
import { useModulos } from '../context/ModulosContext.jsx';
import { etiquetaVista, gruposVisibles } from '../navigation.js';
import { RUTA_DESPUES_LOGOUT, rutaParaVista, vistaParaRuta } from '../routing.js';
import {
  IconoInicio, IconoAnimal, IconoOjo, IconoCalendario, IconoCorral, IconoPaquete,
  IconoCapas, IconoSalud, IconoLista, IconoPersona, IconoPersonas, IconoIntercambio,
  IconoEtiqueta, IconoCarrito, IconoTendencia, IconoReportes, IconoCampana, IconoLibro,
  IconoEngranaje, IconoImpresora, IconoSalir, IconoDinero, IconoBalanza, IconoCorazon, IconoHoja,
  IconoMovimiento,
  IconoRancho,
} from './Iconos.jsx';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad, suscribirConectividad } from '../offline/connectivity.js';
import { SOPORTE_OFFLINE, soporteOfflineVista } from '../offline/support.js';

function Badge({ n }) {
  if (!n) return null;
  return (
    <span className="nav-badge">
      {n > 99 ? '99+' : n}
    </span>
  );
}

export default function Sidebar() {
  const { usuario, cerrarSesion, estadoAutenticacion } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const vista = vistaParaRuta(location.pathname) || 'inicio';
  const { total, tareasPendientes } = useAlertas() || {};
  const { activo, modulos } = useModulos() || {};
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [conectividad, setConectividad] = useState(obtenerEstadoConectividad);
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || conectividad === CONECTIVIDAD_OFFLINE;
  const [compacto, setCompacto] = useState(() => {
    try { return window.localStorage.getItem('el-rancho:sidebar-compacto') === 'true'; } catch { return false; }
  });
  const [gruposAbiertos, setGruposAbiertos] = useState({ ganado: true });
  const grupos = useMemo(
    () => gruposVisibles(usuario?.rol, (clave) => !activo || activo(clave)),
    [usuario?.rol, modulos], // activo refleja precisamente esta colección
  );

  const iconos = {
    inicio: IconoInicio, alertas: IconoCampana, tareas: IconoLista, calendario: IconoCalendario,
    animales: IconoAnimal, seguimiento: IconoOjo, corrales: IconoCorral, movimientos: IconoMovimiento,
    'planes-sanitarios': IconoSalud, reproduccion: IconoCorazon, alimentacion: IconoHoja,
    pesajes: IconoTendencia, insumos: IconoPaquete, lote: IconoCapas, ventas: IconoEtiqueta,
    compras: IconoCarrito, gastos: IconoDinero, finanzas: IconoBalanza, rentabilidad: IconoTendencia,
    reportes: IconoReportes, listas: IconoImpresora, terceros: IconoIntercambio,
    trabajadores: IconoPersona, usuarios: IconoPersonas, bitacora: IconoLibro, configuracion: IconoEngranaje, perfil: IconoPersona,
  };

  useEffect(() => {
    return suscribirConectividad(setConectividad);
  }, []);

  useEffect(() => {
    const grupoActual = grupos.find((grupo) => grupo.items.some((item) => item.id === vista));
    if (grupoActual && !grupoActual.siempreAbierto) {
      setGruposAbiertos((actuales) => ({ ...actuales, [grupoActual.id]: true }));
    }
  }, [vista]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menuAbierto) return undefined;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const cerrarConEscape = (evento) => { if (evento.key === 'Escape') setMenuAbierto(false); };
    window.addEventListener('keydown', cerrarConEscape);
    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener('keydown', cerrarConEscape);
    };
  }, [menuAbierto]);

  useEffect(() => {
    document.documentElement.dataset.sidebar = compacto ? 'compacto' : 'amplio';
    try { window.localStorage.setItem('el-rancho:sidebar-compacto', String(compacto)); } catch { /* Preferencia no crítica. */ }
    return () => { delete document.documentElement.dataset.sidebar; };
  }, [compacto]);

  async function salir() {
    if (!(await cerrarSesion())) return;
    navigate(RUTA_DESPUES_LOGOUT, { replace: true });
    setMenuAbierto(false);
  }

  function alternarGrupo(id) {
    setGruposAbiertos((actuales) => ({ ...actuales, [id]: !actuales[id] }));
  }

  return (
    <>
      <header className="mobile-topbar">
        <button className="mobile-menu-button" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú" aria-expanded={menuAbierto} aria-controls="navegacion-principal">
          <span /><span /><span />
        </button>
        <div>
          <span className="mobile-ranch-label"><IconoRancho width={17} height={17} /> El Rancho</span>
          <strong>{etiquetaVista(vista)}</strong>
        </div>
        <button type="button" className="mobile-profile-button" onClick={() => navigate('/perfil')} aria-label="Abrir mi perfil">{usuario?.nombre?.trim()?.charAt(0)?.toUpperCase() || 'U'}</button>
      </header>

    <nav id="navegacion-principal" className={`sidebar ${menuAbierto ? 'sidebar-abierto' : ''}`} aria-label="Navegación principal">
      <div className="sidebar-brand-row">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden="true"><IconoRancho width={30} height={30} /></span>
          <span className="sidebar-brand-copy"><strong>El Rancho</strong><small>Gestión ganadera</small></span>
        </div>
        <button className="sidebar-cerrar" onClick={() => setMenuAbierto(false)} aria-label="Cerrar menú">×</button>
        <button
          type="button"
          className="sidebar-compact-toggle"
          onClick={() => setCompacto((valor) => !valor)}
          aria-label={compacto ? 'Ampliar menú lateral' : 'Compactar menú lateral'}
          title={compacto ? 'Ampliar menú' : 'Compactar menú'}
        >
          <span aria-hidden="true">{compacto ? '›' : '‹'}</span>
        </button>
      </div>

      <div className="sidebar-ranch-status">
        <span className="sidebar-ranch-pulse"><i /></span>
        <span><strong>Operación activa</strong><small>El rancho, al día</small></span>
      </div>

      <div className="sidebar-scroll product-navigation">
        {grupos.map((grupo) => {
          const abierto = grupo.siempreAbierto || gruposAbiertos[grupo.id];
          return (
            <section key={grupo.id} className={`sidebar-grupo sidebar-group-${grupo.id} ${grupo.siempreAbierto ? 'sidebar-hoy' : ''}`}>
              {grupo.siempreAbierto ? (
                <div className="sidebar-grupo-titulo">{grupo.titulo}</div>
              ) : (
                <button className="sidebar-grupo-boton" onClick={() => alternarGrupo(grupo.id)} aria-expanded={Boolean(abierto)}>
                  {grupo.titulo}<span aria-hidden="true">⌄</span>
                </button>
              )}
              {abierto && <div className="sidebar-grupo-items">
                {grupo.items.map((item) => {
                  const Icono = iconos[item.id] || IconoLista;
                  const badge = item.id === 'alertas' ? total : item.id === 'tareas' ? tareasPendientes : null;
                  const soporte = soporteOfflineVista(item.id);
                  const etiquetaSoporte = soporte === SOPORTE_OFFLINE.FULL ? 'Offline' : soporte === SOPORTE_OFFLINE.PARTIAL ? 'Parcial' : 'Internet';
                  return (
                    <NavLink
                      key={item.id}
                      to={rutaParaVista(item.id)}
                      end={item.id === 'inicio'}
                      className={({ isActive }) => `nav-item nav-module-${item.id} ${sinConexion ? `is-${soporte}` : ''} ${isActive ? 'active' : ''}`}
                      onClick={() => setMenuAbierto(false)}
                      title={compacto ? item.label : undefined}
                      data-tooltip={item.label}
                    >
                      <span className="nav-icon"><Icono /></span>
                      <span className="nav-label">{item.label}</span>
                      {sinConexion && <span className={`nav-offline-capability is-${soporte}`} title={soporte === SOPORTE_OFFLINE.ONLINE_ONLY ? 'Esta sección necesita conexión' : `${etiquetaSoporte}: disponible ${soporte === SOPORTE_OFFLINE.PARTIAL ? 'parcialmente' : ''} sin conexión`}>{etiquetaSoporte}</span>}
                      <Badge n={badge} />
                    </NavLink>
                  );
                })}
              </div>}
            </section>
          );
        })}
      </div>

      <div className="sidebar-usuario">
        <button type="button" className="sidebar-profile-card" onClick={() => { navigate('/perfil'); setMenuAbierto(false); }} data-tooltip="Mi perfil">
          <span className="sidebar-avatar">{usuario?.nombre?.trim()?.charAt(0)?.toUpperCase() || 'U'}</span>
          <span className="sidebar-user-copy"><strong>{usuario?.nombre}</strong><small>{usuario?.rol}</small></span>
          <span className="sidebar-profile-arrow" aria-hidden="true">›</span>
        </button>
        <button className="sidebar-logout-button" onClick={salir} aria-label="Cerrar sesión" title="Cerrar sesión"><IconoSalir /></button>
      </div>
    </nav>
    {menuAbierto && <button className="sidebar-overlay" onClick={() => setMenuAbierto(false)} aria-label="Cerrar menú" />}
    </>
  );
}
