-- Migración: interruptores de "funciones avanzadas".
-- Ejecuta esto en tu base de datos EXISTENTE.
-- Se guardan como 1 (encendido) o 0 (apagado) en la misma tabla de configuración.
-- En ESTA base de datos (la tuya, ya en uso) se activan todos por defecto,
-- para no ocultarte nada de lo que ya tenías funcionando.

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('funcion_ia_activa', 1, 'Muestra el asistente de IA (chat flotante y resúmenes)'),
    ('funcion_clima_activa', 1, 'Muestra el panel de clima en Inicio'),
    ('funcion_calendario_activa', 1, 'Muestra la sección de Calendario'),
    ('funcion_listas_imprimibles_activa', 1, 'Muestra la sección de Listas imprimibles'),
    ('funcion_genealogia_activa', 1, 'Muestra la pestaña de Árbol genealógico en el seguimiento'),
    ('funcion_finanzas_activa', 1, 'Muestra las secciones de Finanzas y Gastos generales'),
    ('funcion_qr_activa', 1, 'Muestra los códigos QR (individual y etiquetas para imprimir)'),
    ('funcion_historial_tercero_activa', 1, 'Muestra el historial filtrado por proveedor/comprador')
ON CONFLICT (clave) DO NOTHING;
