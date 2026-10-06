import ModuleHeader from './ModuleHeader.jsx';

export function PresentacionPantalla({ titulo, descripcion, etiqueta, accion, children, className = '', icono, estado, acento = 'rancho', variante = 'default' }) {
  return (
    <ModuleHeader
      eyebrow={etiqueta}
      title={titulo}
      description={descripcion}
      icon={icono}
      action={accion}
      status={estado}
      accent={acento}
      variant={variante}
      className={`guided-intro ${className}`.trim()}
    >
      {children}
    </ModuleHeader>
  );
}

export function SelectorTarea({ opciones, valor, onSeleccionar, titulo = '¿Qué deseas hacer?', descripcion }) {
  return (
    <section className="guided-task-section" aria-labelledby="guided-task-title">
      <div className="guided-section-heading">
        <span className="guided-step">Paso 1</span>
        <div><h2 id="guided-task-title">{titulo}</h2>{descripcion && <p>{descripcion}</p>}</div>
      </div>
      <div className="guided-task-grid">
        {opciones.map((opcion) => {
          const Icono = opcion.icono;
          return (
            <button
              key={opcion.id}
              type="button"
              className={`guided-task-card ${valor === opcion.id ? 'activa' : ''}`}
              onClick={() => !opcion.noDisponible && onSeleccionar(opcion.id)}
              disabled={opcion.noDisponible}
              aria-pressed={!opcion.noDisponible ? valor === opcion.id : undefined}
              aria-describedby={`guided-task-${opcion.id}`}
            >
              {Icono && <span className="guided-task-icon" aria-hidden="true"><Icono width={22} height={22} /></span>}
              <span><strong>{opcion.titulo}</strong><small id={`guided-task-${opcion.id}`}>{opcion.descripcion}</small></span>
              {opcion.noDisponible ? <em>No disponible todavía</em> : <span aria-hidden="true">→</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function EncabezadoDetalle({ titulo = 'Información detallada', descripcion, paso = 'Paso 2' }) {
  return (
    <div className="guided-section-heading guided-detail-heading">
      <span className="guided-step">{paso}</span>
      <div><h2>{titulo}</h2>{descripcion && <p>{descripcion}</p>}</div>
    </div>
  );
}

export function SelectorDetalle({ opciones, valor, onSeleccionar, etiqueta = 'Elige la información que deseas consultar' }) {
  return (
    <div className="module-view-switcher" role="group" aria-label={etiqueta}>
      {opciones.map((opcion) => (
        <button
          key={opcion.id}
          type="button"
          className={valor === opcion.id ? 'activa' : ''}
          aria-pressed={valor === opcion.id}
          onClick={() => onSeleccionar(opcion.id)}
        >
          <span>{opcion.etiqueta}</span>
          {opcion.contador !== undefined && <strong aria-label={`${opcion.contador} elementos`}>{opcion.contador}</strong>}
        </button>
      ))}
    </div>
  );
}
