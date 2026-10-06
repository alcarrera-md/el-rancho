export const MAX_EXCEL_BYTES = 5 * 1024 * 1024;

export function validarTamanoExcel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'No se pudo determinar el tamaño del archivo.';
  if (bytes > MAX_EXCEL_BYTES) return 'El archivo Excel no puede superar 5 MB.';
  return null;
}
