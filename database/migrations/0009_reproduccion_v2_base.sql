-- Reproducción v2: hechos normalizados y semántica explícita.
-- evento_reproductivo se conserva sin cambios como fuente histórica legado.

CREATE TABLE ciclo_reproductivo (
    id SERIAL PRIMARY KEY,
    hembra_id INTEGER NOT NULL REFERENCES animal(id),
    fecha_inicio DATE NOT NULL,
    fecha_cierre DATE,
    resultado_final VARCHAR(30),
    observaciones TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    origen VARCHAR(30) NOT NULL DEFAULT 'manual',
    legado_evento_id INTEGER UNIQUE REFERENCES evento_reproductivo(id),
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ciclo_reproductivo_resultado_check CHECK (
        resultado_final IS NULL OR resultado_final IN ('parida', 'vacia', 'perdida_aborto', 'cerrado_otro')
    ),
    CONSTRAINT ciclo_reproductivo_origen_check CHECK (origen IN ('manual', 'migracion_legado')),
    CONSTRAINT ciclo_reproductivo_cierre_check CHECK (
        (fecha_cierre IS NULL AND resultado_final IS NULL)
        OR (fecha_cierre IS NOT NULL AND resultado_final IS NOT NULL AND fecha_cierre >= fecha_inicio)
    )
);

CREATE UNIQUE INDEX ciclo_reproductivo_un_abierto_por_hembra
    ON ciclo_reproductivo(hembra_id) WHERE fecha_cierre IS NULL;
CREATE INDEX idx_ciclo_reproductivo_hembra_fecha ON ciclo_reproductivo(hembra_id, fecha_inicio DESC);

CREATE TABLE servicio_reproductivo (
    id SERIAL PRIMARY KEY,
    ciclo_id INTEGER NOT NULL REFERENCES ciclo_reproductivo(id) ON DELETE RESTRICT,
    fecha DATE NOT NULL,
    tipo VARCHAR(40) NOT NULL,
    macho_id INTEGER REFERENCES animal(id),
    tipo_otro VARCHAR(120),
    responsable_id INTEGER REFERENCES trabajador(id),
    observaciones TEXT,
    fecha_parto_estimada_ajustada DATE,
    procedencia_fecha_parto_estimada VARCHAR(20),
    origen VARCHAR(30) NOT NULL DEFAULT 'manual',
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT servicio_reproductivo_tipo_check CHECK (tipo IN ('natural', 'inseminacion_artificial', 'otro')),
    CONSTRAINT servicio_reproductivo_otro_check CHECK (
        (tipo = 'otro' AND tipo_otro IS NOT NULL AND btrim(tipo_otro) <> '') OR
        (tipo <> 'otro' AND tipo_otro IS NULL)
    ),
    CONSTRAINT servicio_reproductivo_estimacion_check CHECK (
        (fecha_parto_estimada_ajustada IS NULL AND procedencia_fecha_parto_estimada IS NULL) OR
        (fecha_parto_estimada_ajustada > fecha AND procedencia_fecha_parto_estimada IN ('manual', 'legado'))
    ),
    CONSTRAINT servicio_reproductivo_origen_check CHECK (origen IN ('manual', 'migracion_legado'))
);
CREATE INDEX idx_servicio_reproductivo_ciclo_fecha ON servicio_reproductivo(ciclo_id, fecha DESC);
CREATE INDEX idx_servicio_reproductivo_macho ON servicio_reproductivo(macho_id);

CREATE TABLE diagnostico_gestacion (
    id SERIAL PRIMARY KEY,
    ciclo_id INTEGER NOT NULL REFERENCES ciclo_reproductivo(id) ON DELETE RESTRICT,
    servicio_id INTEGER REFERENCES servicio_reproductivo(id) ON DELETE RESTRICT,
    fecha DATE NOT NULL,
    metodo VARCHAR(30) NOT NULL,
    metodo_otro VARCHAR(120),
    resultado VARCHAR(20) NOT NULL,
    responsable_id INTEGER REFERENCES trabajador(id),
    observaciones TEXT,
    fecha_siguiente_revision DATE,
    origen VARCHAR(30) NOT NULL DEFAULT 'manual',
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT diagnostico_gestacion_metodo_check CHECK (metodo IN ('palpacion', 'ecografia', 'otro')),
    CONSTRAINT diagnostico_gestacion_otro_check CHECK (
        (metodo = 'otro' AND metodo_otro IS NOT NULL AND btrim(metodo_otro) <> '') OR
        (metodo <> 'otro' AND metodo_otro IS NULL)
    ),
    CONSTRAINT diagnostico_gestacion_resultado_check CHECK (resultado IN ('prenada', 'vacia', 'dudoso')),
    CONSTRAINT diagnostico_gestacion_revision_check CHECK (
        fecha_siguiente_revision IS NULL OR fecha_siguiente_revision > fecha
    ),
    CONSTRAINT diagnostico_gestacion_origen_check CHECK (origen IN ('manual', 'migracion_legado'))
);
CREATE INDEX idx_diagnostico_gestacion_ciclo_fecha ON diagnostico_gestacion(ciclo_id, fecha DESC, id DESC);

CREATE TABLE parto_reproductivo (
    id SERIAL PRIMARY KEY,
    ciclo_id INTEGER NOT NULL UNIQUE REFERENCES ciclo_reproductivo(id) ON DELETE RESTRICT,
    fecha_real DATE NOT NULL,
    resultado VARCHAR(30) NOT NULL,
    incidencia TEXT,
    observaciones TEXT,
    responsable_id INTEGER REFERENCES trabajador(id),
    origen VARCHAR(30) NOT NULL DEFAULT 'manual',
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT parto_reproductivo_resultado_check CHECK (resultado IN ('parto', 'aborto', 'perdida')),
    CONSTRAINT parto_reproductivo_origen_check CHECK (origen IN ('manual', 'migracion_legado'))
);
CREATE INDEX idx_parto_reproductivo_fecha ON parto_reproductivo(fecha_real DESC);

CREATE TABLE parto_cria (
    id SERIAL PRIMARY KEY,
    parto_id INTEGER NOT NULL REFERENCES parto_reproductivo(id) ON DELETE CASCADE,
    cria_id INTEGER REFERENCES animal(id),
    sexo_capturado VARCHAR(10),
    peso_kg NUMERIC(10,2),
    estado_nacimiento VARCHAR(20) NOT NULL DEFAULT 'desconocido',
    incidencia TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT parto_cria_unica UNIQUE (parto_id, cria_id),
    CONSTRAINT parto_cria_sexo_check CHECK (sexo_capturado IS NULL OR sexo_capturado IN ('hembra', 'macho')),
    CONSTRAINT parto_cria_peso_check CHECK (peso_kg IS NULL OR peso_kg > 0),
    CONSTRAINT parto_cria_estado_check CHECK (estado_nacimiento IN ('vivo', 'muerto', 'desconocido'))
);

CREATE OR REPLACE FUNCTION actualizar_version_ciclo_reproductivo()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := OLD.version + 1;
    NEW.actualizado_en := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ciclo_reproductivo_version
BEFORE UPDATE ON ciclo_reproductivo
FOR EACH ROW EXECUTE FUNCTION actualizar_version_ciclo_reproductivo();

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('dias_gestacion_bovina', 283, 'Duración operativa usada para estimar el parto; debe ajustarse al protocolo veterinario del rancho'),
    ('dias_espera_diagnostico_gestacion', 35, 'Días desde el servicio antes de marcar el diagnóstico de gestación como pendiente')
ON CONFLICT (clave) DO NOTHING;

-- Solo se clasifican eventos cerrados cuya evidencia histórica es inequívoca.
INSERT INTO ciclo_reproductivo
    (hembra_id, fecha_inicio, fecha_cierre, resultado_final, origen, legado_evento_id)
SELECT er.madre_id,
       er.fecha_monta,
       er.fecha_parto_real,
       CASE
           WHEN er.resultado = 'aborto' THEN 'perdida_aborto'
           WHEN er.resultado = 'vacio' THEN 'vacia'
           ELSE 'parida'
       END,
       'migracion_legado',
       er.id
FROM evento_reproductivo er
WHERE er.fecha_parto_real IS NOT NULL
  AND (
      er.resultado IN ('exitoso', 'aborto', 'vacio')
      OR er.cria_id IS NOT NULL
  );

INSERT INTO servicio_reproductivo
    (ciclo_id, fecha, tipo, macho_id, fecha_parto_estimada_ajustada,
     procedencia_fecha_parto_estimada, origen)
SELECT cr.id,
       er.fecha_monta,
       er.tipo_monta,
       er.padre_id,
       CASE WHEN er.fecha_parto_estimada IS NOT NULL THEN er.fecha_parto_estimada END,
       CASE WHEN er.fecha_parto_estimada IS NOT NULL THEN 'legado' END,
       'migracion_legado'
FROM ciclo_reproductivo cr
JOIN evento_reproductivo er ON er.id = cr.legado_evento_id;

INSERT INTO parto_reproductivo
    (ciclo_id, fecha_real, resultado, origen)
SELECT cr.id,
       er.fecha_parto_real,
       CASE WHEN er.resultado = 'aborto' THEN 'aborto' ELSE 'parto' END,
       'migracion_legado'
FROM ciclo_reproductivo cr
JOIN evento_reproductivo er ON er.id = cr.legado_evento_id
WHERE cr.resultado_final IN ('parida', 'perdida_aborto');

INSERT INTO parto_cria (parto_id, cria_id, sexo_capturado, peso_kg, estado_nacimiento)
SELECT pr.id, er.cria_id, a.sexo, a.peso_nacimiento_kg,
       CASE WHEN a.estado = 'muerto' THEN 'muerto' ELSE 'vivo' END
FROM parto_reproductivo pr
JOIN ciclo_reproductivo cr ON cr.id = pr.ciclo_id
JOIN evento_reproductivo er ON er.id = cr.legado_evento_id
JOIN animal a ON a.id = er.cria_id
WHERE er.cria_id IS NOT NULL;
