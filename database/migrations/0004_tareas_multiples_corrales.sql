CREATE TABLE asignacion_tarea_corral (
  tarea_id INT NOT NULL REFERENCES asignacion_tarea(id) ON DELETE CASCADE,
  corral_id INT NOT NULL REFERENCES corral(id),
  PRIMARY KEY (tarea_id, corral_id)
);

INSERT INTO asignacion_tarea_corral (tarea_id, corral_id)
SELECT id, corral_id
FROM asignacion_tarea
WHERE corral_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX idx_asignacion_tarea_corral_corral
  ON asignacion_tarea_corral(corral_id, tarea_id);
