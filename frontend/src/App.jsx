import { lazy, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from './api';
import { AUTH_OFFLINE, AUTH_ONLINE, useAuth } from './auth/AuthContext.jsx';
import { useModulos } from './context/ModulosContext.jsx';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatFlotante from './components/ChatFlotante.jsx';
import AccesoRestringido from './components/AccesoRestringido.jsx';
import PaginaNoEncontrada from './components/PaginaNoEncontrada.jsx';
import CargaDiferida from './components/CargaDiferida.jsx';
import { puedeVerVista, tienePermiso } from './authorization/permissions.js';
import { crearRutaContextual, obtenerAreteLegacy, rutaParaVista, rutaSeguimientoAnimal } from './routing.js';
import { CARGADORES_SUPERFICIES, CARGADORES_VISTAS } from './routeLoaders.js';
import { crearMapaDiferido } from './lazyLoading.js';
import { useFeedbackOperacion } from './context/FeedbackOperacionContext.jsx';
import { detalleMovimientoConfirmado } from './feedbackOperacion.js';
import BotonVolver from './components/BotonVolver.jsx';
import SeccionRequiereConexion from './components/SeccionRequiereConexion.jsx';
import ResumenOffline from './components/ResumenOffline.jsx';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad, suscribirConectividad } from './offline/connectivity.js';
import { SOPORTE_OFFLINE, soporteOfflineVista } from './offline/support.js';

function RutaProtegida({ vista, children }) {
  const { usuario } = useAuth();
  return puedeVerVista(usuario?.rol, vista) ? children : <AccesoRestringido />;
}

function RedireccionAnimal() {
  const { id } = useParams();
  if (!/^\d+$/.test(id || '')) return <PaginaNoEncontrada animal />;
  return <Navigate to={rutaSeguimientoAnimal(id)} replace />;
}

function SeguimientoEnrutado({ activo, ComponenteSeguimiento, mostrarChat = true }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  if (!/^\d+$/.test(id || '')) return <div className="seguimiento-shell"><div className="seguimiento-contenido"><PaginaNoEncontrada animal /></div></div>;
  return (
    <>
      <ComponenteSeguimiento
        animalId={id}
        onVolver={() => navigate('/animales')}
        onVolverReproduccion={() => navigate('/reproduccion')}
        onCambiarAnimal={(animalId) => navigate(`${rutaSeguimientoAnimal(animalId)}${location.search}`)}
      />
      {mostrarChat && (!activo || activo('ia')) && <ChatFlotante />}
    </>
  );
}

export default function App() {
  const { usuario, cargando, estadoAutenticacion, refrescarSesion } = useAuth();
  const { activo } = useModulos() || {};
  const { mostrarExito } = useFeedbackOperacion();
  const navigate = useNavigate();
  const location = useLocation();
  const [revisionCarga, setRevisionCarga] = useState(0);
  const [refrescoClave, setRefrescoClave] = useState(0);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [capturaRapida, setCapturaRapida] = useState({ abierta: false, accion: null });
  const [mensajeGlobal, setMensajeGlobal] = useState('');
  const [conectividad, setConectividad] = useState(obtenerEstadoConectividad());
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || conectividad === CONECTIVIDAD_OFFLINE;
  const puedeCrearAnimal = tienePermiso(usuario?.rol, 'animales', 'crear');

  useEffect(() => suscribirConectividad(setConectividad), []);

  // Los tipos lazy permanecen estables al navegar. Sólo un reintento explícito
  // crea tipos nuevos para descartar la promesa rechazada que React conserva.
  const vistasDiferidas = useMemo(
    () => crearMapaDiferido(lazy, CARGADORES_VISTAS),
    [revisionCarga],
  );
  const superficiesDiferidas = useMemo(
    () => crearMapaDiferido(lazy, CARGADORES_SUPERFICIES),
    [revisionCarga],
  );
  const {
    inicio: Dashboard, animales: AnimalesList, seguimiento: SeguimientoList, corrales: CorralesList,
    movimientos: Movimientos, 'planes-sanitarios': Sanidad, reproduccion: Reproduccion,
    alimentacion: Alimentacion, pesajes: Pesajes, insumos: InsumosList, lote: TrabajoPorLote,
    ventas: VentasReporte, compras: ComprasList, gastos: GastosGenerales, finanzas: Finanzas,
    rentabilidad: RentabilidadReporte, reportes: ReportesGenerales, tareas: TareasList,
    calendario: Calendario, listas: ListasImprimibles, alertas: Alertas, terceros: TercerosList,
    trabajadores: TrabajadoresList, usuarios: UsuariosList, bitacora: BitacoraList,
    configuracion: ConfiguracionPanel, sincronizacion: SincronizacionPanel, perfil: Perfil,
  } = vistasDiferidas;
  const {
    seguimientoAnimal: SeguimientoAnimal,
    nuevoAnimal: NuevoAnimalModal,
    capturaRapida: CapturaRapidaModal,
    capturaModuloOffline: CapturaModuloOffline,
    seguimientoAnimalOffline: SeguimientoAnimalOffline,
  } = superficiesDiferidas;

  function reintentarCarga(diagnostico) {
    console.info('[frontend-lazy-retry]', {
      tipo: diagnostico?.tipo,
      modulo: diagnostico?.error?.cargaDiferida?.modulo,
      ruta: location.pathname,
      fecha: new Date().toISOString(),
    });
    setRevisionCarga((revision) => revision + 1);
  }

  function abrirSeguimiento(id, contexto = {}) {
    navigate(crearRutaContextual(rutaSeguimientoAnimal(id), contexto));
  }

  function navegarVista(vista, contexto) {
    navigate(crearRutaContextual(rutaParaVista(vista), contexto));
  }

  function abrirCapturaRapida(accion = null) {
    setMensajeGlobal('');
    setCapturaRapida({ abierta: true, accion });
  }

  useEffect(() => {
    if (usuario && estadoAutenticacion === AUTH_ONLINE) refrescarSesion({ actualizarSnapshot: false }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, usuario?.id, estadoAutenticacion]);

  // Compatibilidad temporal con los QR/enlaces históricos /?animal=ARETE.
  useEffect(() => {
    if (!usuario || location.pathname !== '/' || sinConexion) return undefined;
    const arete = obtenerAreteLegacy(location.search);
    if (!arete) return undefined;
    let vigente = true;
    api.listarAnimales({ q: arete }).then((resultados) => {
      if (!vigente) return;
      const encontrado = resultados.find((animal) => animal.arete_id.toLowerCase() === arete.toLowerCase());
      if (encontrado) navigate(rutaSeguimientoAnimal(encontrado.id), { replace: true });
      else {
        setMensajeGlobal(`No se encontró un animal con el arete ${arete}.`);
        navigate('/', { replace: true });
      }
    }).catch(() => {
      if (vigente) setMensajeGlobal('No se pudo resolver el enlace antiguo del animal.');
    });
    return () => { vigente = false; };
  }, [usuario, location.pathname, location.search, navigate, sinConexion]);

  if (cargando) return <div className="route-loading" role="status" aria-live="polite">Comprobando sesión…</div>;
  if (!usuario) return <Login />;
  function marco(vista, contenido) {
    const requiereConexion = sinConexion && soporteOfflineVista(vista) === SOPORTE_OFFLINE.ONLINE_ONLY;
    return (
      <div className="app-shell" data-active-module={vista}>
        <Sidebar />
        <main className="main module-surface" data-module={vista}>
          {mensajeGlobal && <div className="status-banner app-toast" role="status">{mensajeGlobal}</div>}
          <RutaProtegida vista={vista}>
            {requiereConexion ? <SeccionRequiereConexion /> : (
              <CargaDiferida nombreModulo={vista} claveRecuperacion={`${location.key}-${revisionCarga}`} onReintentar={reintentarCarga}>{contenido}</CargaDiferida>
            )}
          </RutaProtegida>
        </main>
        {!sinConexion && (!activo || activo('ia')) && <ChatFlotante />}
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={marco('inicio', sinConexion ? <ResumenOffline onCapturaRapida={abrirCapturaRapida} onIrSincronizacion={() => navigate('/configuracion/sincronizacion')} /> : <Dashboard onCapturaRapida={abrirCapturaRapida} key={`inicio-${refrescoClave}`} />)} />
        <Route path="/animales" element={marco('animales', <AnimalesList key={refrescoClave} onNuevo={() => setMostrarModal(true)} onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/seguimiento" element={marco('seguimiento', sinConexion ? <AnimalesList key={`offline-${refrescoClave}`} modoSeguimiento onAbrirSeguimiento={abrirSeguimiento} /> : <SeguimientoList key={refrescoClave} onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/corrales" element={marco('corrales', <CorralesList onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/movimientos" element={marco('movimientos', sinConexion ? <CapturaModuloOffline modulo="movimientos" /> : <Movimientos onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/salud" element={marco('planes-sanitarios', <Sanidad onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/reproduccion" element={marco('reproduccion', <Reproduccion onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/alimentacion" element={marco('alimentacion', sinConexion ? <CapturaModuloOffline modulo="alimentacion" /> : <Alimentacion onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/pesajes" element={marco('pesajes', sinConexion ? <CapturaModuloOffline modulo="pesajes" /> : <Pesajes onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/insumos" element={marco('insumos', <InsumosList />)} />
        <Route path="/trabajo-por-lote" element={marco('lote', <TrabajoPorLote />)} />
        <Route path="/ventas" element={marco('ventas', <VentasReporte />)} />
        <Route path="/compras" element={marco('compras', <ComprasList />)} />
        <Route path="/gastos" element={marco('gastos', <GastosGenerales />)} />
        <Route path="/finanzas" element={marco('finanzas', <Finanzas />)} />
        <Route path="/rentabilidad" element={marco('rentabilidad', <RentabilidadReporte />)} />
        <Route path="/reportes" element={marco('reportes', <ReportesGenerales />)} />
        <Route path="/tareas" element={marco('tareas', <TareasList />)} />
        <Route path="/calendario" element={marco('calendario', <Calendario onAbrirSeguimiento={abrirSeguimiento} />)} />
        <Route path="/listas" element={marco('listas', <ListasImprimibles />)} />
        <Route path="/alertas" element={marco('alertas', <Alertas onAbrirSeguimiento={abrirSeguimiento} irA={navegarVista} />)} />
        <Route path="/terceros" element={marco('terceros', <TercerosList />)} />
        <Route path="/trabajadores" element={marco('trabajadores', <TrabajadoresList />)} />
        <Route path="/usuarios" element={marco('usuarios', <UsuariosList />)} />
        <Route path="/bitacora" element={marco('bitacora', <BitacoraList />)} />
        <Route path="/configuracion" element={marco('configuracion', <ConfiguracionPanel />)} />
        <Route path="/configuracion/apariencia" element={marco('apariencia', <ConfiguracionPanel seccion="apariencia" />)} />
        <Route path="/configuracion/sincronizacion" element={marco('sincronizacion', <SincronizacionPanel seccion="sincronizacion" />)} />
        <Route path="/configuracion/:seccion" element={marco('configuracion', <ConfiguracionPanel />)} />
        <Route path="/perfil" element={marco('perfil', <Perfil />)} />
        <Route path="/animales/:id" element={<RutaProtegida vista="seguimiento"><RedireccionAnimal /></RutaProtegida>} />
        <Route path="/animales/:id/seguimiento" element={sinConexion
          ? marco('seguimiento', <SeguimientoEnrutado activo={activo} ComponenteSeguimiento={SeguimientoAnimalOffline} mostrarChat={false} />)
          : <RutaProtegida vista="seguimiento"><div className="internal-fullscreen-back"><BotonVolver destino="/animales" /></div><CargaDiferida nombreModulo="seguimiento-animal" claveRecuperacion={`${location.key}-${revisionCarga}`} onReintentar={reintentarCarga}><SeguimientoEnrutado activo={activo} ComponenteSeguimiento={SeguimientoAnimal} /></CargaDiferida></RutaProtegida>} />
        <Route path="*" element={marco('inicio', <PaginaNoEncontrada />)} />
      </Routes>

      {mostrarModal && puedeCrearAnimal && !sinConexion && (
        <CargaDiferida nombreModulo="nuevo-animal" mensaje="Preparando formulario…" claveRecuperacion={`${location.key}-${revisionCarga}`} onReintentar={reintentarCarga}><NuevoAnimalModal
          onCerrar={() => setMostrarModal(false)}
          onCreado={(animal) => {
            setMostrarModal(false);
            mostrarExito({ titulo: 'Animal registrado correctamente', mensaje: `${animal.nombre_alias || animal.arete_id} ya forma parte del hato.` });
            abrirSeguimiento(animal.id);
          }}
        /></CargaDiferida>
      )}
      {capturaRapida.abierta && (
        <CargaDiferida nombreModulo="captura-rapida" mensaje="Preparando captura rápida…" claveRecuperacion={`${location.key}-${revisionCarga}`} onReintentar={reintentarCarga}><CapturaRapidaModal
          accionInicial={capturaRapida.accion}
          onCerrar={() => setCapturaRapida({ abierta: false, accion: null })}
          onCompletado={(mensaje, resultado) => {
            setCapturaRapida({ abierta: false, accion: null });
            setRefrescoClave((clave) => clave + 1);
            mostrarExito(resultado?.movimiento
              ? detalleMovimientoConfirmado(resultado.animal, resultado.movimiento)
              : { titulo: mensaje });
          }}
        /></CargaDiferida>
      )}
    </>
  );
}
