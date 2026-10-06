const db = require('./db');
const { obtenerConfiguracion } = require('./configuracion');
const { registrarBitacora } = require('./bitacora');
const { enviarCorreo } = require('./mailer');

// Mismas etiquetas que usa el frontend en BitacoraList.jsx — se mantienen
// aquí también porque backend y frontend son proyectos npm independientes,
// sin código compartido entre ambos.
const ETIQUETAS_ACCION = {
  crear_animal: 'Alta de animal',
  importar_animales: 'Importación masiva de animales',
  editar_animal: 'Edición de animal',
  dar_baja_animal: 'Baja de animal',
  cambiar_estado_salud: 'Cambio de estado de salud',
  cambiar_categoria: 'Cambio de categoría',
  editar_animal_ia: 'Edición de animal (vía asistente IA)',
  editar_trabajador_ia: 'Edición de trabajador (vía asistente IA)',
  editar_usuario_ia: 'Edición de usuario (vía asistente IA)',
  crear_tarea: 'Asignación de tarea',
  editar_tarea: 'Edición o reasignación de tarea',
  completar_tarea: 'Tarea completada',
  reabrir_tarea: 'Tarea reabierta',
  eliminar_tarea: 'Eliminación de tarea',
  bloqueo_cuenta: 'Bloqueo de cuenta por intentos fallidos',
  desbloquear_usuario: 'Desbloqueo de cuenta',
  login: 'Inicio de sesión',
  comprar_insumo: 'Compra de insumo',
  crear_corral: 'Alta de corral',
  editar_corral: 'Edición de corral',
  comprar_animal: 'Registro de compra de animal',
  comprar_animal_nuevo: 'Alta de animal por compra',
  registrar_gasto: 'Registro de gasto',
  editar_configuracion: 'Edición de configuración',
  editar_modulos: 'Edición de módulos activos',
  registrar_venta: 'Registro de venta',
  registrar_venta_lote: 'Registro de venta por lote',
  crear_usuario: 'Alta de usuario',
  editar_usuario: 'Edición de usuario',
  envio_corte_diario: 'Envío del corte diario por correo',
  agregar_destinatario_corte: 'Alta de destinatario extra del corte diario',
  quitar_destinatario_corte: 'Baja de destinatario extra del corte diario',
};

const ETIQUETAS_ENTIDAD = {
  animal: 'Animales',
  corral: 'Corrales',
  venta: 'Ventas',
  venta_lote: 'Ventas por lote',
  compra_animal: 'Compras de animales',
  compra_insumo: 'Compras de insumos',
  gasto_general: 'Gastos',
  asignacion_tarea: 'Tareas',
  usuario: 'Usuarios',
  trabajador: 'Trabajadores',
  configuracion: 'Configuración',
  modulo_sistema: 'Módulos',
  corte_diario_bitacora: 'Sistema',
};
const ORDEN_ENTIDADES = Object.keys(ETIQUETAS_ENTIDAD);

// "Hoy" en la fecha local del servidor, no en UTC — toISOString() convierte
// a UTC primero y puede regresar el día siguiente/anterior según la zona
// horaria, lo cual rompería la comparación contra CURRENT_DATE de Postgres.
function fechaLocalHoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Arma el HTML del corte: eventos de bitácora de ese día, agrupados por
// entidad (no una taxonomía inventada — es la misma columna real que ya
// tiene cada fila), cada uno en una línea con hora/usuario/acción/detalle
// compacto — no un volcado de JSON.
async function construirCorreoCorte(fecha) {
  const { rows } = await db.query(
    `SELECT b.accion, b.entidad, b.detalle, b.fecha, u.nombre AS usuario
     FROM bitacora b LEFT JOIN usuario u ON u.id = b.usuario_id
     WHERE b.fecha::date = $1::date
     ORDER BY b.fecha`,
    [fecha]
  );

  const grupos = new Map();
  for (const e of rows) {
    const clave = e.entidad || 'otros';
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(e);
  }
  const clavesOrdenadas = [
    ...ORDEN_ENTIDADES.filter((k) => grupos.has(k)),
    ...[...grupos.keys()].filter((k) => !ORDEN_ENTIDADES.includes(k)),
  ];

  const fechaLegible = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  let html = `
    <div style="font-family: Arial, sans-serif; color: #2b2b2b; max-width: 640px;">
      <h2 style="color:#5b7553; margin-bottom: 4px;">Corte diario de bitácora</h2>
      <p style="margin-top:0; color:#666;">${fechaLegible} · ${rows.length} evento(s) registrado(s)</p>
  `;

  if (rows.length === 0) {
    html += `<p>No hubo actividad registrada este día.</p>`;
  } else {
    for (const clave of clavesOrdenadas) {
      const eventos = grupos.get(clave);
      html += `
        <h3 style="color:#3f3f3f; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-top: 20px; font-size: 1rem;">
          ${ETIQUETAS_ENTIDAD[clave] || clave} (${eventos.length})
        </h3>
        <ul style="padding-left: 18px; margin: 8px 0;">
      `;
      for (const e of eventos) {
        const hora = new Date(e.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        const detalle = e.detalle ? Object.entries(e.detalle).map(([k, v]) => `${k}: ${v}`).join(' · ') : null;
        html += `
          <li style="margin-bottom: 4px; font-size: 0.9rem;">
            <strong>${hora}</strong> — ${e.usuario || 'Sistema'} — ${ETIQUETAS_ACCION[e.accion] || e.accion}
            ${detalle ? `<span style="color:#777;"> (${detalle})</span>` : ''}
          </li>
        `;
      }
      html += `</ul>`;
    }
  }

  html += `
      <p style="margin-top: 24px; font-size: 0.78rem; color: #999;">
        Generado automáticamente por el Sistema de Gestión Ganadera.
      </p>
    </div>
  `;

  return { html, totalEventos: rows.length };
}

// Manda el corte de "fecha" a todos los administradores activos + los
// destinatarios extra (corte_diario_destinatario, se suman, no reemplazan a
// los administradores) y deja constancia en corte_diario_bitacora (upsert:
// se puede reenviar el mismo día si hace falta, por ejemplo si el envío
// automático falló).
async function enviarCorteDiario(fecha, { enviadoPor } = {}) {
  const { html, totalEventos } = await construirCorreoCorte(fecha);
  const fechaLegible = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

  const { rows: admins } = await db.query(
    `SELECT u.email FROM usuario u JOIN rol r ON r.id = u.rol_id
     WHERE r.nombre = 'Administrador' AND u.activo = true`
  );
  const { rows: extras } = await db.query('SELECT email FROM corte_diario_destinatario');
  const destinatarios = [...admins, ...extras];

  let enviados = 0;
  for (const destinatario of destinatarios) {
    try {
      await enviarCorreo({ to: destinatario.email, subject: `Corte diario — ${fechaLegible}`, html });
      enviados++;
    } catch (err) {
      console.error(`No se pudo enviar el corte diario a ${destinatario.email}:`, err.message);
    }
  }

  if (enviados === 0) {
    throw new Error(destinatarios.length === 0
      ? 'No hay administradores activos ni destinatarios extra a quién mandar el corte.'
      : 'No se pudo enviar el corte a nadie — revisa EMAIL_REMITENTE/EMAIL_APP_PASSWORD en el .env.');
  }

  const { rows } = await db.query(
    `INSERT INTO corte_diario_bitacora (fecha, total_eventos, destinatarios, enviado_por)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (fecha) DO UPDATE SET
       enviado_en = now(), total_eventos = $2, destinatarios = $3, enviado_por = $4
     RETURNING *`,
    [fecha, totalEventos, enviados, enviadoPor || null]
  );
  const corte = rows[0];

  await registrarBitacora(enviadoPor ? { id: enviadoPor, rol: 'Administrador' } : null,
    'envio_corte_diario', 'corte_diario_bitacora', corte.id, {
      despues: corte,
      contexto: { fecha, destinatarios: enviados, total_eventos: totalEventos },
    });

  return corte;
}

// Llamada periódica (ver cron en app.js): decide si ya toca mandar el
// corte de hoy, leyendo la hora de configuracion en vivo cada vez.
async function verificarYEnviarCorteDiarioAutomatico() {
  const config = await obtenerConfiguracion();
  if (new Date().getHours() < config.hora_corte_diario) return;

  const hoy = fechaLocalHoy();
  const { rows } = await db.query('SELECT 1 FROM corte_diario_bitacora WHERE fecha = $1', [hoy]);
  if (rows.length) return; // ya se mandó hoy

  await enviarCorteDiario(hoy);
}

module.exports = { construirCorreoCorte, enviarCorteDiario, verificarYEnviarCorteDiarioAutomatico, fechaLocalHoy, ETIQUETAS_ACCION };
