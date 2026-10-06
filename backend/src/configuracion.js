const db = require('./db');

// Valores de respaldo por si la tabla no tiene todavía alguna clave
// (por ejemplo, si se agrega una nueva configuración en el futuro)
const DEFAULTS = {
  dias_alerta_vacuna: 30,
  dias_alerta_parto: 30,
  dias_gestacion_bovina: 283,
  dias_espera_diagnostico_gestacion: 35,
  pct_corral_casi_lleno: 90,
  dias_sin_pesaje_alerta: 60,
  dias_sin_ordeno_alerta: 3,
  pct_caida_leche_alerta: 15,
  ganancia_diaria_minima_kg: 0.3,
  precio_leche_litro: 0,
  max_intentos_login: 5,
  minutos_bloqueo_login: 15,
  dias_ventana_brote_ia: 45,
  min_afectados_cluster_brote: 2,
  hora_corte_diario: 22,
};

async function obtenerConfiguracion() {
  try {
    const { rows } = await db.query('SELECT clave, valor FROM configuracion');
    const config = { ...DEFAULTS };
    rows.forEach((r) => {
      // Un valor ausente no equivale a cero. Esto es especialmente
      // importante para coordenadas: 0,0 es una ubicación real.
      if (r.valor === null || r.valor === undefined || String(r.valor).trim() === '') {
        config[r.clave] = undefined;
        return;
      }
      const valor = Number(r.valor);
      config[r.clave] = Number.isFinite(valor) ? valor : r.valor;
    });
    return config;
  } catch (err) {
    console.error('No se pudo leer la configuración, usando valores por defecto:', err.message);
    return { ...DEFAULTS };
  }
}

module.exports = { obtenerConfiguracion, DEFAULTS };
