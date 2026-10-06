-- Migración: crear el primer usuario Administrador para poder iniciar sesión.
-- Ejecuta esto en tu base de datos EXISTENTE.

-- pgcrypto ya debería estar habilitado desde schema.sql, pero por seguridad:
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- IMPORTANTE: cambia 'admin@rancho.com' y 'CambiaEstaClave123' antes de ejecutar,
-- o cámbialos después iniciando sesión y usando la pantalla de Usuarios.
INSERT INTO usuario (nombre, email, password_hash, rol_id)
SELECT 'Administrador', 'admin@rancho.com', crypt('CambiaEstaClave123', gen_salt('bf')), r.id
FROM rol r WHERE r.nombre = 'Administrador'
ON CONFLICT (email) DO NOTHING;
