import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  CATEGORIAS_ALERTA, construirAlertas, obtenerAtencionInmediata,
  resumirAlertas, SEVERIDADES_ALERTA,
} from '../alertas.js';
import { useModulos } from '../context/ModulosContext.jsx';
import AnalisisBroteIAModal from './AnalisisBroteIAModal.jsx';
import EstadoSaludBadge from './EstadoSaludBadge.jsx';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { PresentacionPantalla } from './PresentacionGuiada.jsx';
import {
  mensajeCargaParcial, resolverCargaParcial, respuestaEsArreglo, respuestaEsObjeto,
} from '../cargasParciales.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { IconoCampana } from './Iconos.jsx';

const PRESENTACION_SEVERIDAD = {
  critica: { ayuda: 'Atender primero' },
  advertencia: { ayuda: 'Programar pronto' },
  info: { ayuda: 'Mantener en seguimiento' },
};

function TarjetaAlerta({ alerta, onAccion, onAnalizarIA, mostrarDetalle = false }) {
  const severidad = SEVERIDADES_ALERTA[alerta.severidad];
  return (
    <article className={`alert-center-card alerta-${alerta.severidad}`}>
      <div className="alert-center-card-top">
        <div className="alert-center-badges">
          <span className={`alert-severity alerta-${alerta.severidad}`}><span aria-hidden="true" />{severidad.label}</span>
          <span className="alert-type">{alerta.tipo}</span>
        </div>
        <span className="alert-entity">{alerta.entidad}</span>
      </div>
      <h3>{alerta.titulo}</h3>
      <p>{alerta.contexto}</p>

      {mostrarDetalle && alerta.detalle?.tipo === 'cluster' && (
        <details className="alert-cluster-detail">
          <summary>Ver animales del grupo</summary>
          <div className="alert-cluster-animals">
            {alerta.detalle.animales.map((animal) => (
              <div key={animal.id}>
                <span><span className="tag-badge">{animal.arete_id}</span> {animal.nombre_alias || ''}</span>
                <EstadoSaludBadge estado={animal.estado} estadoSalud={animal.estado_salud} tamano="chico" />
              </div>
            ))}
          </div>
          {onAnalizarIA && alerta.detalle.animalAnclaId && (
            <button type="button" className="btn btn-ghost" onClick={() => onAnalizarIA(alerta.detalle.animalAnclaId)}>
              Analizar grupo con IA
            </button>
          )}
        </details>
      )}

      {alerta.accion && (
        <button type="button" className="alert-card-action" onClick={() => onAccion(alerta.accion)}>
          {alerta.accion.etiqueta} <span aria-hidden="true">→</span>
        </button>
      )}
    </article>
  );
}

export default function Alertas({ onAbrirSeguimiento, irA }) {
  const { activo } = useModulos() || {};
  const { usuario } = useAuth();
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [categoriaActiva, setCategoriaActiva] = useState('sanidad');
  const [mostrarTodo, setMostrarTodo] = useState(false);
  const [analizarAnimalId, setAnalizarAnimalId] = useState(null);

  async function cargar() {
    setCargando(true);
    setError(null);
    const siguientes = {};
    const solicitudes = [
      { clave: 'vacunas', etiqueta: 'Vacunas', ruta: '/api/salud/proximas?dias=30&incluirVencidas=true', promesa: api.proximasVacunas(30, true), valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'stock', etiqueta: 'Stock bajo', ruta: '/api/alimentacion/stock-bajo', promesa: api.stockBajo(), valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'hato', etiqueta: 'Alertas del hato', ruta: '/api/alertas/hato', promesa: api.alertasHato(), valorInicial: { clusters: [], pesajes_atrasados: [], mortalidad: null }, validar: respuestaEsObjeto },
      { clave: 'partos', etiqueta: 'Partos', ruta: '/api/reproduccion/partos-proximos?dias=30&incluirVencidos=true', promesa: api.partosProximos(30, true), valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'enfermos', etiqueta: 'Animales enfermos', ruta: '/api/animales?estado=vivo&estado_salud=enfermo', promesa: api.listarAnimales({ estado: 'vivo', estado_salud: 'enfermo' }), valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'observacion', etiqueta: 'Animales en observación', ruta: '/api/animales?estado=vivo&estado_salud=observacion', promesa: api.listarAnimales({ estado: 'vivo', estado_salud: 'observacion' }), valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'corrales', etiqueta: 'Corrales', ruta: '/api/corrales', promesa: api.listarCorrales(), valorInicial: [], validar: respuestaEsArreglo },
      { clave: 'resumen', etiqueta: 'Resumen de alertas', ruta: '/api/alertas/resumen', promesa: api.resumenAlertas(), valorInicial: {}, validar: respuestaEsObjeto },
    ].map((solicitud) => ({ ...solicitud, aplicar: (valor) => { siguientes[solicitud.clave] = valor; } }));
    const diagnostico = await resolverCargaParcial(solicitudes, { contexto: 'Centro de alertas', rol: usuario?.rol });
    setDatos(siguientes);
    setError(mensajeCargaParcial(diagnostico));
    setCargando(false);
  }

  useEffect(() => { void cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const alertas = useMemo(() => (datos ? construirAlertas(datos) : []), [datos]);
  const resumen = useMemo(() => resumirAlertas(alertas), [alertas]);
  const inmediatas = useMemo(() => obtenerAtencionInmediata(alertas), [alertas]);
  const alertasCategoria = alertas.filter((alerta) => alerta.categoria === categoriaActiva);
  const visiblesCategoria = mostrarTodo ? alertasCategoria : alertasCategoria.slice(0, 5);
  const categoria = CATEGORIAS_ALERTA.find((item) => item.id === categoriaActiva);

  function seleccionarCategoria(id) {
    setCategoriaActiva(id);
    setMostrarTodo(false);
  }

  function ejecutarAccion(accion) {
    if (accion.tipo === 'animal') onAbrirSeguimiento(accion.id);
    else irA(accion.vista, accion.contexto);
  }

  return (
    <div className="alert-center">
      <PresentacionPantalla
        etiqueta="Centro de atención"
        titulo="¿Qué requiere atención ahora?"
        descripcion="Revisa primero lo urgente y después explora cada área del rancho sin recorrer listas interminables."
        icono={IconoCampana}
        acento="alerta"
        estado={!cargando ? `${resumen.total} activas` : 'Actualizando'}
      />

      {error && <EstadoError mensaje={error} onReintentar={cargar} />}

      {cargando ? <EstadoCarga mensaje="Reuniendo alertas del rancho…" /> : (
        <>
          <section className="alert-overview" aria-labelledby="alertas-panorama">
            <div className="guided-section-heading">
              <span className="guided-step">Panorama</span>
              <div><h2 id="alertas-panorama">Qué necesita atención</h2><p>{resumen.total} aviso{resumen.total === 1 ? '' : 's'} con la información disponible.</p></div>
            </div>
            <div className="alert-summary-grid">
              {Object.keys(PRESENTACION_SEVERIDAD).map((severidad) => (
                <div key={severidad} className={`alert-summary-card alerta-${severidad}`}>
                  <span className="alert-summary-dot" aria-hidden="true" />
                  <strong>{resumen[severidad]}</strong>
                  <span>{SEVERIDADES_ALERTA[severidad].label}</span>
                  <small>{PRESENTACION_SEVERIDAD[severidad].ayuda}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="alert-immediate" aria-labelledby="alertas-inmediatas">
            <div className="guided-section-heading">
              <span className="guided-step">Primero</span>
              <div><h2 id="alertas-inmediatas">Atención inmediata</h2><p>Los asuntos críticos y próximos más importantes en este momento.</p></div>
            </div>
            {inmediatas.length === 0 ? (
              <EstadoVacio titulo="No hay asuntos urgentes" descripcion="Puedes revisar los indicadores informativos por categoría." compacto />
            ) : (
              <div className="alert-immediate-grid">
                {inmediatas.map((alerta) => <TarjetaAlerta key={alerta.id} alerta={alerta} onAccion={ejecutarAccion} />)}
              </div>
            )}
          </section>

          <section className="alert-categories" aria-labelledby="alertas-categorias">
            <div className="guided-section-heading">
              <span className="guided-step">Explorar</span>
              <div><h2 id="alertas-categorias">Alertas por área</h2><p>Elige un área para consultar su detalle. Solo se abre una a la vez.</p></div>
            </div>
            <div className="alert-category-grid" aria-label="Categorías de alertas">
              {CATEGORIAS_ALERTA.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`alert-category-button ${categoriaActiva === item.id ? 'activa' : ''}`}
                  onClick={() => seleccionarCategoria(item.id)}
                  aria-pressed={categoriaActiva === item.id}
                >
                  <strong>{resumen.categorias[item.id] || 0}</strong>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            <div className="alert-category-panel" aria-live="polite">
              <div className="alert-category-heading">
                <div><h3>{categoria?.label}</h3><p>{categoria?.descripcion}</p></div>
                <span>{alertasCategoria.length} aviso{alertasCategoria.length === 1 ? '' : 's'}</span>
              </div>
              {alertasCategoria.length === 0 ? (
                <EstadoVacio titulo={`Sin alertas de ${categoria?.label.toLowerCase()}`} descripcion="No hay información que requiera revisión en esta área." compacto />
              ) : (
                <div className="alert-category-list">
                  {visiblesCategoria.map((alerta) => (
                    <TarjetaAlerta
                      key={alerta.id}
                      alerta={alerta}
                      onAccion={ejecutarAccion}
                      mostrarDetalle
                      onAnalizarIA={activo && activo('ia') ? setAnalizarAnimalId : null}
                    />
                  ))}
                  {alertasCategoria.length > 5 && (
                    <button type="button" className="btn btn-ghost alert-show-more" onClick={() => setMostrarTodo((actual) => !actual)}>
                      {mostrarTodo ? 'Mostrar menos' : `Mostrar ${alertasCategoria.length - 5} aviso(s) más`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {analizarAnimalId && <AnalisisBroteIAModal animalId={analizarAnimalId} onCerrar={() => setAnalizarAnimalId(null)} />}
    </div>
  );
}
