import { useState } from 'react';
import { api } from '../api';
import { exportarPlantillaImportacion, leerExcelAnimales } from '../exportUtils.js';
import { validarTamanoExcel } from '../excelSecurity.js';

export default function ImportarAnimalesModal({ onCerrar, onListo }) {
  const [filas, setFilas] = useState(null);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [importando, setImportando] = useState(false);

  function manejarArchivo(e) {
    const archivo = e.target.files[0];
    if (!archivo) return;
    const errorTamano = validarTamanoExcel(archivo.size);
    if (errorTamano) {
      setError(errorTamano);
      setFilas(null);
      setNombreArchivo('');
      e.target.value = '';
      return;
    }
    setError(null);
    setResultado(null);
    setNombreArchivo(archivo.name);

    const lector = new FileReader();
    lector.onload = async (evento) => {
      try {
        const datos = await leerExcelAnimales(evento.target.result);
        if (datos.length === 0) {
          setError('El archivo no tiene filas con datos (o el arete de cada fila está vacío).');
          setFilas(null);
          return;
        }
        setFilas(datos);
      } catch (err) {
        setError(err.message?.startsWith('ENCABEZADOS_EXCEL_INVALIDOS')
          ? 'Los encabezados no coinciden con la plantilla. Descárgala de nuevo y conserva las columnas en el mismo orden.'
          : 'No se pudo leer el archivo. Confirma que sea el formato de la plantilla (.xlsx).');
        setFilas(null);
      }
    };
    lector.readAsArrayBuffer(archivo);
  }

  async function descargarPlantilla() {
    setError(null);
    try {
      await exportarPlantillaImportacion();
    } catch (err) {
      setError(`No se pudo preparar la plantilla: ${err.message}`);
    }
  }

  async function confirmarImportacion() {
    setImportando(true);
    setError(null);
    try {
      const resultado = await api.importarAnimales(filas);
      setResultado(resultado);
      setFilas(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h3>Importar animales desde Excel</h3>

        {!resultado && (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
              1. Descarga la plantilla. 2. Llénala con tus animales (una fila por cada uno).
              3. Súbela aquí para revisarla antes de importar.
            </p>
            <button type="button" className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={descargarPlantilla}>
              Descargar plantilla de Excel
            </button>

            <div className="field">
              <label>Archivo lleno (.xlsx)</label>
              <input type="file" accept=".xlsx" onChange={manejarArchivo} />
              {nombreArchivo && <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{nombreArchivo}</span>}
            </div>
          </>
        )}

        {error && <div className="error-banner">{error}</div>}

        {filas && !resultado && (
          <>
            <div className="section-title">Vista previa — {filas.length} animal(es) a importar</div>
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, marginBottom: 14 }}>
              <table className="animal-table">
                <thead>
                  <tr><th>Fila</th><th>Arete</th><th>Alias</th><th>Sexo</th><th>Raza</th><th>Corral</th></tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.fila} style={(!f.arete_id || !['hembra', 'macho'].includes(f.sexo)) ? { background: 'var(--rust-soft)' } : undefined}>
                      <td>{f.fila}</td>
                      <td>{f.arete_id || <em>vacío</em>}</td>
                      <td>{f.nombre_alias || '—'}</td>
                      <td>{f.sexo || <em>vacío</em>}</td>
                      <td>{f.raza || '—'}</td>
                      <td>{f.corral || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
              Las filas resaltadas en rojo tienen arete o sexo inválido y no se importarán. Las demás se procesarán normal.
            </p>
          </>
        )}

        {resultado && (
          <div className="error-banner" style={{
            background: resultado.errores.length ? 'var(--rust-soft)' : 'var(--wheat-soft)',
            color: resultado.errores.length ? 'var(--rust)' : '#6b4f10',
            borderColor: resultado.errores.length ? '#e3b7ab' : 'var(--wheat)',
          }}>
            <strong>{resultado.creados.length} animal(es) importado(s) correctamente{resultado.errores.length ? `, ${resultado.errores.length} con error` : ''}.</strong>
            {resultado.errores.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {resultado.errores.map((e, i) => (
                  <li key={i} style={{ fontSize: '0.82rem' }}>Fila {e.fila} ({e.arete_id}): {e.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={resultado ? onListo : onCerrar}>
            {resultado ? 'Cerrar' : 'Cancelar'}
          </button>
          {filas && !resultado && (
            <button type="button" className="btn btn-primary" onClick={confirmarImportacion} disabled={importando}>
              {importando ? 'Importando...' : `Importar ${filas.length} animal(es)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
