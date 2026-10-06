import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const directorio = new URL('../dist/', import.meta.url);
const informe = JSON.parse(await readFile(new URL('bundle-analysis.json', directorio), 'utf8'));
const porArchivo = new Map(informe.chunks.map((chunk) => [chunk.fileName, chunk]));
const entrada = informe.chunks.find((chunk) => chunk.isEntry);
if (!entrada) throw new Error('No se encontró el chunk de entrada para verificar el bundle.');

const iniciales = new Set();
function visitar(fileName) {
  if (iniciales.has(fileName)) return;
  iniciales.add(fileName);
  (porArchivo.get(fileName)?.imports || []).forEach(visitar);
}
visitar(entrada.fileName);

const dependenciasPesadas = /node_modules[\\/](?:jspdf|jspdf-autotable|read-excel-file|write-excel-file|recharts|qrcode)[\\/]/;
const modulosPesadosIniciales = [...iniciales]
  .flatMap((archivo) => porArchivo.get(archivo)?.modules || [])
  .filter((modulo) => dependenciasPesadas.test(modulo));
if (modulosPesadosIniciales.length) {
  throw new Error(`Dependencias pesadas en la carga inicial:\n${modulosPesadosIniciales.join('\n')}`);
}

let bytesIniciales = 0;
let gzipInicial = 0;
for (const archivo of iniciales) {
  const ruta = new URL(archivo, directorio);
  const contenido = await readFile(ruta);
  bytesIniciales += (await stat(ruta)).size;
  gzipInicial += gzipSync(contenido).length;
}
if (bytesIniciales > 500_000) throw new Error(`El JavaScript inicial supera el límite acordado: ${bytesIniciales} bytes.`);

const resumen = {
  chunksJavaScript: informe.chunks.length,
  chunksDiferidos: informe.chunks.filter((chunk) => chunk.isDynamicEntry).length,
  archivosIniciales: [...iniciales],
  bytesIniciales,
  gzipInicial,
  dependenciasPesadasIniciales: 0,
};
console.log('Verificación del bundle:', JSON.stringify(resumen, null, 2));
