import QRCode from 'qrcode';

// Uso: node print-local-qr.mjs <url> [--png <ruta.png>]
// El QR contiene solo la dirección local de la app: nunca credenciales,
// tokens ni parámetros de sesión.
const [raw, ...resto] = process.argv.slice(2);
if (!raw) {
  console.error('Falta la URL para generar el QR.');
  process.exit(1);
}

let url;
try {
  url = new URL(raw);
} catch {
  console.error('La URL del QR no es valida.');
  process.exit(1);
}

if (url.protocol !== 'http:' && url.protocol !== 'https:') {
  console.error('El QR solo admite direcciones HTTP o HTTPS.');
  process.exit(1);
}
if (url.username || url.password || url.search || url.hash) {
  console.error('El QR solo puede contener la direccion de la app, sin credenciales ni parametros.');
  process.exit(1);
}

const qr = await QRCode.toString(url.toString(), {
  type: 'terminal',
  small: true,
  errorCorrectionLevel: 'M',
  margin: 1,
});
process.stdout.write(qr);

const indicePng = resto.indexOf('--png');
if (indicePng >= 0 && resto[indicePng + 1]) {
  // Respaldo para consolas cuya fuente no dibuja bien los bloques del QR.
  await QRCode.toFile(resto[indicePng + 1], url.toString(), { errorCorrectionLevel: 'M', margin: 2, width: 420 });
}
