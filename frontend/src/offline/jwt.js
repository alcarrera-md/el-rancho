// Lectura local (sin verificar firma) de los claims del propio JWT del
// dispositivo. Esto NUNCA es un límite de seguridad — el backend sigue
// siendo la única fuente de verdad de si un token es válido (autenticar
// en middleware/auth.js recarga usuario/rol/sesion_version en cada
// petición). Acá solo lo usamos para saber, de forma puramente local,
// "quién dice ser este dispositivo" y "hasta cuándo dice durar su sesión"
// — para poder decidir a qué usuario_id de IndexedDB mirar y hasta cuándo
// permitir el arranque offline, incluso sin poder preguntarle al servidor.
export function decodificarJWT(token) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const payloadBase64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(payloadBase64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    const claims = JSON.parse(json);
    return {
      id: claims.id,
      nombre: claims.nombre,
      email: claims.email,
      rol: claims.rol,
      sesion_version: claims.sesion_version,
      expiraEn: typeof claims.exp === 'number' ? new Date(claims.exp * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}
