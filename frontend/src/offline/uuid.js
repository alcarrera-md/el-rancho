// UUID v4 para identificadores offline (instalación y capturas).
//
// crypto.randomUUID solo existe en contextos seguros (HTTPS o localhost). En
// http://IP de la red local no está disponible, y antes eso impedía guardar la
// sesión offline sin avisar. crypto.getRandomValues sí existe en cualquier
// contexto y es el mismo generador criptográfico, así que el UUID resultante
// tiene la misma calidad.
export function generarUUID(cripto = globalThis.crypto) {
  if (typeof cripto?.randomUUID === 'function') return cripto.randomUUID();
  if (typeof cripto?.getRandomValues !== 'function') {
    throw new Error('Este navegador no puede crear identificadores seguros para el modo sin conexión.');
  }
  const bytes = cripto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
