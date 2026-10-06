-- Migración: bloqueo automático de cuenta tras varios intentos fallidos de login.
-- Ejecuta esto en tu base de datos EXISTENTE.

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS intentos_fallidos INT NOT NULL DEFAULT 0;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMP;

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('max_intentos_login', 5, 'Intentos fallidos de inicio de sesión antes de bloquear la cuenta'),
    ('minutos_bloqueo_login', 15, 'Minutos que dura el bloqueo automático de una cuenta tras exceder los intentos fallidos')
ON CONFLICT (clave) DO NOTHING;
