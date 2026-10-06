ALTER TABLE asignacion_tarea
  ALTER COLUMN descripcion TYPE TEXT,
  ADD COLUMN titulo VARCHAR(150),
  ADD COLUMN tipo VARCHAR(40) NOT NULL DEFAULT 'otra',
  ADD COLUMN animal_id INT REFERENCES animal(id),
  ADD COLUMN insumo_id INT REFERENCES insumo(id),
  ADD COLUMN cantidad DECIMAL(10,2),
  ADD COLUMN prioridad VARCHAR(15) NOT NULL DEFAULT 'media',
  ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  ADD COLUMN creador_usuario_id INT REFERENCES usuario(id),
  ADD COLUMN creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN completado_en TIMESTAMPTZ;

UPDATE asignacion_tarea
SET titulo = LEFT(descripcion, 150),
    estado = CASE WHEN completada THEN 'completada' ELSE 'pendiente' END,
    completado_en = CASE WHEN completada THEN fecha::timestamp ELSE NULL END;

ALTER TABLE asignacion_tarea
  ALTER COLUMN titulo SET NOT NULL,
  ADD CONSTRAINT asignacion_tarea_tipo_check CHECK (tipo IN (
    'revision_salud', 'alimentacion', 'pesaje', 'movimiento',
    'vacunacion_tratamiento', 'revision_general', 'otra'
  )),
  ADD CONSTRAINT asignacion_tarea_prioridad_check CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
  ADD CONSTRAINT asignacion_tarea_estado_check CHECK (estado IN ('pendiente', 'en_progreso', 'completada', 'cancelada')),
  ADD CONSTRAINT asignacion_tarea_cantidad_check CHECK (cantidad IS NULL OR cantidad > 0);

CREATE INDEX idx_asignacion_tarea_responsable_estado ON asignacion_tarea(trabajador_id, estado, fecha);
CREATE INDEX idx_asignacion_tarea_contexto ON asignacion_tarea(corral_id, animal_id);

CREATE OR REPLACE FUNCTION sincronizar_estado_asignacion_tarea()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.titulo := COALESCE(NULLIF(NEW.titulo, ''), LEFT(NEW.descripcion, 150));
    IF NEW.completada = TRUE OR NEW.estado = 'completada' THEN
      NEW.estado := 'completada';
      NEW.completada := TRUE;
      NEW.completado_en := COALESCE(NEW.completado_en, now());
    ELSE
      NEW.completada := FALSE;
      NEW.completado_en := NULL;
    END IF;
  ELSIF NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.completada := NEW.estado = 'completada';
    NEW.completado_en := CASE WHEN NEW.estado = 'completada' THEN COALESCE(NEW.completado_en, now()) ELSE NULL END;
  ELSIF NEW.completada IS DISTINCT FROM OLD.completada THEN
    NEW.estado := CASE WHEN NEW.completada THEN 'completada' ELSE 'pendiente' END;
    NEW.completado_en := CASE WHEN NEW.completada THEN COALESCE(NEW.completado_en, now()) ELSE NULL END;
  END IF;
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asignacion_tarea_estado
BEFORE INSERT OR UPDATE ON asignacion_tarea
FOR EACH ROW EXECUTE FUNCTION sincronizar_estado_asignacion_tarea();
