-- P3: trazabilidad e idempotencia para captura masiva e importación reproductiva.

ALTER TABLE ciclo_reproductivo DROP CONSTRAINT ciclo_reproductivo_origen_check;
ALTER TABLE ciclo_reproductivo ADD CONSTRAINT ciclo_reproductivo_origen_check
  CHECK (origen IN ('manual', 'migracion_legado', 'captura_masiva', 'importacion_excel'));

ALTER TABLE servicio_reproductivo DROP CONSTRAINT servicio_reproductivo_origen_check;
ALTER TABLE servicio_reproductivo ADD CONSTRAINT servicio_reproductivo_origen_check
  CHECK (origen IN ('manual', 'migracion_legado', 'captura_masiva', 'importacion_excel'));

ALTER TABLE diagnostico_gestacion DROP CONSTRAINT diagnostico_gestacion_origen_check;
ALTER TABLE diagnostico_gestacion ADD CONSTRAINT diagnostico_gestacion_origen_check
  CHECK (origen IN ('manual', 'migracion_legado', 'captura_masiva', 'importacion_excel'));

ALTER TABLE parto_reproductivo DROP CONSTRAINT parto_reproductivo_origen_check;
ALTER TABLE parto_reproductivo ADD CONSTRAINT parto_reproductivo_origen_check
  CHECK (origen IN ('manual', 'migracion_legado', 'captura_masiva', 'importacion_excel'));

CREATE TABLE reproduccion_import_batch (
  id UUID PRIMARY KEY,
  archivo_hash CHAR(64) NOT NULL,
  nombre_archivo VARCHAR(255),
  mapeo JSONB NOT NULL DEFAULT '{}'::jsonb,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id),
  total_filas INTEGER NOT NULL CHECK (total_filas > 0),
  estado VARCHAR(20) NOT NULL DEFAULT 'completado'
    CHECK (estado IN ('completado')),
  creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reproduccion_import_batch_archivo
  ON reproduccion_import_batch(archivo_hash, creado_en DESC);

CREATE TABLE reproduccion_import_fila (
  id BIGSERIAL PRIMARY KEY,
  import_batch_id UUID NOT NULL REFERENCES reproduccion_import_batch(id) ON DELETE RESTRICT,
  numero_fila INTEGER NOT NULL CHECK (numero_fila > 0),
  huella CHAR(64) NOT NULL,
  datos_normalizados JSONB NOT NULL,
  resultado JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT reproduccion_import_fila_numero_unique UNIQUE (import_batch_id, numero_fila),
  CONSTRAINT reproduccion_import_fila_huella_unique UNIQUE (huella)
);

CREATE INDEX idx_reproduccion_import_fila_batch
  ON reproduccion_import_fila(import_batch_id, numero_fila);
