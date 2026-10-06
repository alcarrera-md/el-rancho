ALTER TABLE asignacion_tarea
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT asignacion_tarea_version_check CHECK (version > 0);

CREATE OR REPLACE FUNCTION incrementar_version_asignacion_tarea()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asignacion_tarea_version
BEFORE UPDATE ON asignacion_tarea
FOR EACH ROW EXECUTE FUNCTION incrementar_version_asignacion_tarea();

CREATE TABLE operacion_cliente (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id),
  client_operation_id UUID NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  entidad VARCHAR(80) NOT NULL,
  entidad_id BIGINT,
  payload_hash CHAR(64) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'procesando',
  resultado_publico JSONB NOT NULL DEFAULT '{}'::jsonb,
  http_status SMALLINT,
  fecha_local_reportada TIMESTAMPTZ,
  fecha_recibida TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  fecha_aplicada TIMESTAMPTZ,
  dispositivo_id UUID,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT operacion_cliente_usuario_operacion_unique UNIQUE (usuario_id, client_operation_id),
  CONSTRAINT operacion_cliente_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT operacion_cliente_estado_check CHECK (estado IN ('procesando', 'aplicada')),
  CONSTRAINT operacion_cliente_http_status_check CHECK (http_status IS NULL OR http_status BETWEEN 200 AND 299),
  CONSTRAINT operacion_cliente_aplicada_check CHECK (
    (estado = 'procesando' AND fecha_aplicada IS NULL AND http_status IS NULL)
    OR
    (estado = 'aplicada' AND fecha_aplicada IS NOT NULL AND http_status IS NOT NULL)
  )
);

CREATE INDEX idx_operacion_cliente_tipo_fecha
  ON operacion_cliente(tipo, fecha_recibida DESC);

CREATE INDEX idx_operacion_cliente_entidad
  ON operacion_cliente(entidad, entidad_id)
  WHERE entidad_id IS NOT NULL;

CREATE INDEX idx_operacion_cliente_dispositivo
  ON operacion_cliente(dispositivo_id, fecha_recibida DESC)
  WHERE dispositivo_id IS NOT NULL;

CREATE OR REPLACE FUNCTION actualizar_timestamp_operacion_cliente()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_operacion_cliente_actualizado
BEFORE UPDATE ON operacion_cliente
FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_operacion_cliente();
