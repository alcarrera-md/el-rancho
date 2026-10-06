const OPCIONES = {
  servicio: [['semen','Semen'],['inseminacion','Inseminación'],['monta_servicio','Monta / servicio'],['veterinario','Veterinario o técnico'],['otro','Otro']],
  diagnostico: [['palpacion','Palpación'],['ultrasonido','Ultrasonido'],['veterinario','Veterinario'],['transporte','Traslado'],['otro','Otro']],
  parto: [['veterinario','Asistencia veterinaria'],['medicamento_insumo','Medicamento / insumo'],['procedimiento','Procedimiento'],['transporte','Transporte'],['otro','Otro']],
};

export default function CostoReproductivoOpcional({ etapa, valor, onChange }) {
  const opciones = OPCIONES[etapa];
  const actualizar = (campo, contenido) => onChange({ ...valor, [campo]: contenido });
  return <details className="repro-secondary-fields repro-cost-inline">
    <summary>Costos (opcional)</summary>
    <p>Registra solo un costo directo comprobable. Puedes añadir más desde el análisis económico.</p>
    <div className="field"><label>Categoría</label><select value={valor.categoria} onChange={(e) => actualizar('categoria', e.target.value)}>{opciones.map(([id, etiqueta]) => <option key={id} value={id}>{etiqueta}</option>)}</select></div>
    <div className="field"><label>Monto</label><input className="input" inputMode="decimal" placeholder="0.00" value={valor.monto} onChange={(e) => actualizar('monto', e.target.value)} /></div>
    <div className="field"><label>Concepto (opcional)</label><input className="input" maxLength="500" value={valor.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} /></div>
    <small>Déjalo vacío si el costo aún no está registrado. No se asumirá un costo de $0.</small>
  </details>;
}

export function costoParaApi(costo) {
  if (!costo.monto) return undefined;
  return { categoria: costo.categoria, monto: costo.monto, descripcion: costo.descripcion || undefined };
}
