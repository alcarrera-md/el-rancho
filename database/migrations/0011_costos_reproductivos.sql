-- P6: costos reproductivos atribuibles y trazables.
-- La referencia al desembolso original evita duplicarlo en flujo de caja.
CREATE TABLE costo_reproductivo (
    id                  SERIAL PRIMARY KEY,
    fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
    categoria           VARCHAR(30) NOT NULL,
    monto               NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    procedencia         VARCHAR(30) NOT NULL DEFAULT 'captura_manual',
    ciclo_id            INTEGER REFERENCES ciclo_reproductivo(id) ON DELETE RESTRICT,
    servicio_id         INTEGER REFERENCES servicio_reproductivo(id) ON DELETE RESTRICT,
    diagnostico_id      INTEGER REFERENCES diagnostico_gestacion(id) ON DELETE RESTRICT,
    parto_id            INTEGER REFERENCES parto_reproductivo(id) ON DELETE RESTRICT,
    animal_id           INTEGER REFERENCES animal(id) ON DELETE RESTRICT,
    toro_id             INTEGER REFERENCES animal(id) ON DELETE RESTRICT,
    responsable_id      INTEGER REFERENCES trabajador(id) ON DELETE RESTRICT,
    proveedor_id        INTEGER REFERENCES tercero(id) ON DELETE RESTRICT,
    insumo_id            INTEGER REFERENCES insumo(id) ON DELETE RESTRICT,
    compra_insumo_id    INTEGER REFERENCES compra_insumo(id) ON DELETE RESTRICT,
    gasto_general_id    INTEGER REFERENCES gasto_general(id) ON DELETE RESTRICT,
    descripcion         VARCHAR(500),
    usuario_id          INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT costo_reproductivo_categoria_check CHECK (categoria IN (
      'semen','inseminacion','monta_servicio','palpacion','ultrasonido',
      'veterinario','medicamento_insumo','procedimiento','transporte','otro'
    )),
    CONSTRAINT costo_reproductivo_procedencia_check CHECK (procedencia IN (
      'captura_manual','compra_insumo_relacionada','gasto_general_relacionado','importacion','migracion'
    )),
    CONSTRAINT costo_reproductivo_contexto_check CHECK (
      ciclo_id IS NOT NULL OR servicio_id IS NOT NULL OR diagnostico_id IS NOT NULL OR
      parto_id IS NOT NULL OR animal_id IS NOT NULL OR toro_id IS NOT NULL
    ),
    CONSTRAINT costo_reproductivo_fuente_check CHECK (
      (procedencia = 'compra_insumo_relacionada' AND compra_insumo_id IS NOT NULL AND gasto_general_id IS NULL) OR
      (procedencia = 'gasto_general_relacionado' AND gasto_general_id IS NOT NULL AND compra_insumo_id IS NULL) OR
      (procedencia NOT IN ('compra_insumo_relacionada','gasto_general_relacionado')
       AND compra_insumo_id IS NULL AND gasto_general_id IS NULL)
    )
);

CREATE UNIQUE INDEX costo_reproductivo_compra_unica
  ON costo_reproductivo(compra_insumo_id) WHERE compra_insumo_id IS NOT NULL;
CREATE UNIQUE INDEX costo_reproductivo_gasto_unico
  ON costo_reproductivo(gasto_general_id) WHERE gasto_general_id IS NOT NULL;
CREATE INDEX idx_costo_reproductivo_fecha ON costo_reproductivo(fecha DESC);
CREATE INDEX idx_costo_reproductivo_ciclo ON costo_reproductivo(ciclo_id);
CREATE INDEX idx_costo_reproductivo_servicio ON costo_reproductivo(servicio_id);
CREATE INDEX idx_costo_reproductivo_diagnostico ON costo_reproductivo(diagnostico_id);
CREATE INDEX idx_costo_reproductivo_parto ON costo_reproductivo(parto_id);
CREATE INDEX idx_costo_reproductivo_animal ON costo_reproductivo(animal_id);
CREATE INDEX idx_costo_reproductivo_toro ON costo_reproductivo(toro_id);

CREATE OR REPLACE FUNCTION actualizar_costo_reproductivo_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_costo_reproductivo_timestamp
BEFORE UPDATE ON costo_reproductivo
FOR EACH ROW EXECUTE FUNCTION actualizar_costo_reproductivo_timestamp();
