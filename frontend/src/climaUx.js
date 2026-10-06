const MENSAJES_ERROR_CLIMA = Object.freeze({
  OFFLINE: 'Sin conexión. El clima estará disponible al recuperar Internet.',
  NETWORK_ERROR: 'No se pudo conectar con el servidor del rancho.',
  CLIMA_UBICACION_FALTANTE: 'Configura la ubicación del rancho para ver el clima.',
  CLIMA_CONFIG_INVALIDA: 'La configuración del clima no es válida. Revisa la ubicación y la clave del proveedor.',
  CLIMA_TIMEOUT: 'El servicio del clima no respondió a tiempo.',
  CLIMA_PROVEEDOR_RECHAZO: 'El proveedor del clima rechazó la solicitud.',
  CLIMA_TRANSPORTE_ERROR: 'No fue posible conectar con el proveedor del clima.',
  CLIMA_RESPUESTA_INVALIDA: 'El proveedor devolvió información de clima no válida.',
});

export function mensajeErrorClima(error) {
  return MENSAJES_ERROR_CLIMA[error?.code] || error?.message || 'No se pudo cargar el clima.';
}
