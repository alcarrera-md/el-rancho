import { Component, Suspense } from 'react';
import { EstadoCarga, EstadoError } from './EstadosUI.jsx';
import { clasificarErrorCarga, presentacionErrorCarga, resumenDiagnosticoCarga } from '../lazyLoading.js';
import { crearReferenciaRuntime, crearRegistroErrorModulo } from '../runtimeDiagnostics.js';
import { solicitarActualizacionPwa } from '../pwa.js';

export class LimiteCargaDiferida extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, actualizando: false, referencia: crearReferenciaRuntime() };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, informacion) {
    const registro = crearRegistroErrorModulo({
      error,
      componentStack: informacion?.componentStack,
      modulo: this.props.nombreModulo,
      ruta: window.location.pathname,
      desarrollo: import.meta.env.DEV,
      referencia: this.state.referencia,
    });
    console.error('[frontend-module-error]', registro);
  }

  actualizarAplicacion = () => {
    this.setState({ actualizando: true }, () => {
      if (this.props.onActualizar() === false) this.setState({ actualizando: false });
    });
  };

  render() {
    if (this.state.error) {
      const tipo = clasificarErrorCarga(this.state.error);
      const presentacion = presentacionErrorCarga(tipo);
      const diagnostico = resumenDiagnosticoCarga(this.state.error, tipo, {
        modulo: this.props.nombreModulo,
        referencia: this.state.referencia,
      });
      return (
        <div className="route-state lazy-error-state" data-error-carga={tipo}>
          <EstadoError
            titulo={presentacion.titulo}
            mensaje={presentacion.mensaje}
            onReintentar={() => this.props.onReintentar({ tipo, error: this.state.error })}
            textoReintentar={presentacion.textoReintentar}
          />
          <small className="lazy-error-code">Diagnóstico: {diagnostico}</small>
          {presentacion.permiteActualizar && (
            <button type="button" className="btn btn-primary" onClick={this.actualizarAplicacion} disabled={this.state.actualizando}>
              {this.state.actualizando ? 'Actualizando…' : 'Actualizar aplicación'}
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export function recargarAplicacion() {
  window.location.reload();
}

export default function CargaDiferida({ children, mensaje = 'Cargando sección…', claveRecuperacion = 0, nombreModulo = 'desconocido', onReintentar = recargarAplicacion, onActualizar = solicitarActualizacionPwa }) {
  return (
    <LimiteCargaDiferida key={claveRecuperacion} nombreModulo={nombreModulo} onReintentar={onReintentar} onActualizar={onActualizar}>
      <Suspense fallback={<div className="route-loading"><EstadoCarga mensaje={mensaje} /></div>}>
        {children}
      </Suspense>
    </LimiteCargaDiferida>
  );
}
