-- Destinatarios extra del corte diario de bitácora. Conserva la estructura
-- de migracion_corte_diario_destinatarios.sql para instalaciones existentes.
CREATE TABLE IF NOT EXISTS corte_diario_destinatario (
    id         SERIAL PRIMARY KEY,
    email      TEXT UNIQUE NOT NULL,
    creado_en  TIMESTAMP NOT NULL DEFAULT now(),
    creado_por INT REFERENCES usuario(id)
);
