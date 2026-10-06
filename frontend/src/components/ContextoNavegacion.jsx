export default function ContextoNavegacion({ etiqueta, descripcion, onLimpiar, invalido = false }) {
  return (
    <div className={`navigation-context ${invalido ? 'context-invalid' : ''}`} role="status">
      <div><span>{invalido ? 'Contexto no disponible' : 'Mostrando'}</span><strong>{etiqueta}</strong>{descripcion && <small>{descripcion}</small>}</div>
      {onLimpiar && <button type="button" className="btn btn-ghost" onClick={onLimpiar}>Quitar filtro</button>}
    </div>
  );
}
