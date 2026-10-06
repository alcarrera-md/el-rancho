-- Migración: módulos activables/desactivables del sistema.
-- Ejecuta esto en tu base de datos EXISTENTE.
-- En esta base (la tuya, de desarrollo) todos quedan ACTIVOS por default,
-- para no ocultarte nada de lo que ya usas. Para un cliente nuevo, desde
-- "Configuración" se pueden apagar los que no quieras mostrar todavía.

CREATE TABLE IF NOT EXISTS modulo_sistema (
    clave   VARCHAR(50) PRIMARY KEY,
    nombre  VARCHAR(100) NOT NULL,
    activo  BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO modulo_sistema (clave, nombre, activo) VALUES
    ('lote', 'Trabajo por lote', true),
    ('planes-sanitarios', 'Planes sanitarios', true),
    ('calendario', 'Calendario', true),
    ('listas', 'Listas imprimibles', true),
    ('gastos', 'Gastos generales', true),
    ('finanzas', 'Finanzas', true),
    ('genealogia', 'Árbol genealógico', true),
    ('ia', 'Asistente de IA', true)
ON CONFLICT (clave) DO NOTHING;
