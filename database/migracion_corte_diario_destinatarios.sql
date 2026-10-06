-- Migración: destinatarios extra del corte diario de bitácora — correos que
-- reciben el resumen diario ADEMÁS de los administradores activos (no los
-- reemplazan). Pensado para gente que quiere ver el corte sin tener una
-- cuenta de Administrador en el sistema.
-- Ejecuta esto en tu base de datos EXISTENTE.

CREATE TABLE IF NOT EXISTS corte_diario_destinatario (
    id         SERIAL PRIMARY KEY,
    email      TEXT UNIQUE NOT NULL,
    creado_en  TIMESTAMP NOT NULL DEFAULT now(),
    creado_por INT REFERENCES usuario(id)
);
