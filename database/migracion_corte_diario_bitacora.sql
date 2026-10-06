-- Migración: corte diario de bitácora por correo — tabla que registra qué
-- días ya se mandó el resumen (evita duplicados y alimenta el frontend),
-- y el umbral configurable de a qué hora dispararlo automáticamente.
-- Ejecuta esto en tu base de datos EXISTENTE.

CREATE TABLE IF NOT EXISTS corte_diario_bitacora (
    id             SERIAL PRIMARY KEY,
    fecha          DATE UNIQUE NOT NULL,
    enviado_en     TIMESTAMP NOT NULL DEFAULT now(),
    total_eventos  INT NOT NULL,
    destinatarios  INT NOT NULL,
    enviado_por    INT REFERENCES usuario(id)  -- NULL = automático; id del admin si fue manual
);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('hora_corte_diario', 22, 'Hora del día (0-23) a la que se manda automáticamente el resumen de bitácora por correo a los administradores')
ON CONFLICT (clave) DO NOTHING;
