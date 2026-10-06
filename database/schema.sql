-- =========================================================
-- SISTEMA INTELIGENTE DE GESTIÓN GANADERA
-- Esquema de Base de Datos (PostgreSQL)
-- Diseño centrado en el ANIMAL: cada evento de vida cuelga
-- de un animal_id específico para tener una "ficha clínica"
-- individual completa.
-- =========================================================

-- ---------------------------------------------------------
-- EXTENSIONES ÚTILES
-- ---------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- para gen_random_uuid() si se prefiere UUID

-- ---------------------------------------------------------
-- 1. USUARIOS Y TRABAJADORES (seguridad y roles)
-- ---------------------------------------------------------
CREATE TABLE rol (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(50) UNIQUE NOT NULL -- Administrador, Veterinario, Trabajador, Auditor, Comprador, Proveedor
);

CREATE TABLE usuario (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(150) NOT NULL,
    email           VARCHAR(150) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,      -- bcrypt
    rol_id          INT NOT NULL REFERENCES rol(id),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMP NOT NULL DEFAULT now(),
    ultimo_login    TIMESTAMP,
    intentos_fallidos INT NOT NULL DEFAULT 0,
    bloqueado_hasta TIMESTAMP
);

CREATE TABLE trabajador (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuario(id),      -- opcional: no todo trabajador tiene login
    nombre      VARCHAR(150) NOT NULL,
    telefono    VARCHAR(30),
    activo      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------
-- 2. CORRALES
-- ---------------------------------------------------------
CREATE TABLE corral (
    id                  SERIAL PRIMARY KEY,
    nombre              VARCHAR(100) UNIQUE NOT NULL,
    descripcion         TEXT,
    ubicacion           VARCHAR(150),
    capacidad_maxima    INT NOT NULL CHECK (capacidad_maxima > 0),
    trabajador_id       INT REFERENCES trabajador(id), -- responsable
    activo              BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------
-- 3. RAZAS (catálogo simple)
-- ---------------------------------------------------------
CREATE TABLE raza (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(100) UNIQUE NOT NULL
);

-- ---------------------------------------------------------
-- 4. ANIMAL (entidad central del sistema)
-- ---------------------------------------------------------
CREATE TABLE animal (
    id                  SERIAL PRIMARY KEY,
    arete_id            VARCHAR(50) UNIQUE NOT NULL,   -- identificación oficial única (RFID/electrónico)
    nombre_alias        VARCHAR(100),                   -- nombre opcional dado por el ranchero
    sexo                VARCHAR(10) NOT NULL CHECK (sexo IN ('macho','hembra')),
    fecha_nacimiento    DATE,
    raza_id             INT REFERENCES raza(id),
    madre_id            INT REFERENCES animal(id),
    padre_id            INT REFERENCES animal(id),
    origen              VARCHAR(20) NOT NULL DEFAULT 'nacimiento'
                            CHECK (origen IN ('nacimiento','compra','ingreso_externo')),
    corral_actual_id    INT REFERENCES corral(id),
    estado              VARCHAR(20) NOT NULL DEFAULT 'vivo'
                            CHECK (estado IN ('vivo','vendido','sacrificado','muerto')),
    peso_nacimiento_kg  DECIMAL(6,2) CHECK (peso_nacimiento_kg >= 0),
    foto_url            VARCHAR(255),                   -- ruta/nombre del archivo de foto (opcional)
    fecha_baja          DATE,
    razon_baja          TEXT,                           -- causa de muerte / sacrificio, si aplica
    estado_salud        VARCHAR(20) NOT NULL DEFAULT 'sano' CHECK (estado_salud IN ('sano','observacion','enfermo')),
    salud_fecha_inicio  DATE,                            -- desde cuándo, si está enfermo/en observación
    salud_diagnostico   TEXT,
    salud_tratamiento   TEXT,
    categoria           VARCHAR(20) DEFAULT 'cria' CHECK (categoria IN ('cria','destete','engorde','vientre','reproductor','descarte')),
    creado_en           TIMESTAMP NOT NULL DEFAULT now(),

    -- Un animal no puede ser su propio padre/madre
    CHECK (id <> madre_id),
    CHECK (id <> padre_id)
);

CREATE INDEX idx_animal_arete ON animal(arete_id);
CREATE INDEX idx_animal_corral ON animal(corral_actual_id);
CREATE INDEX idx_animal_estado ON animal(estado);
CREATE INDEX idx_animal_madre ON animal(madre_id);

-- ---------------------------------------------------------
-- 5. MOVIMIENTOS / TRASLADOS ENTRE CORRALES (histórico)
-- ---------------------------------------------------------
CREATE TABLE movimiento_corral (
    id              SERIAL PRIMARY KEY,
    animal_id       INT NOT NULL REFERENCES animal(id),
    corral_origen   INT REFERENCES corral(id),
    corral_destino  INT NOT NULL REFERENCES corral(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    motivo          VARCHAR(100),  -- destete, engorde, venta, reubicación
    trabajador_id   INT REFERENCES trabajador(id)
);
CREATE INDEX idx_movimiento_animal ON movimiento_corral(animal_id);

-- ---------------------------------------------------------
-- 6. PESAJES (curva de crecimiento)
-- ---------------------------------------------------------
CREATE TABLE pesaje (
    id          SERIAL PRIMARY KEY,
    animal_id   INT NOT NULL REFERENCES animal(id),
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    peso_kg     DECIMAL(6,2) NOT NULL CHECK (peso_kg >= 0),
    trabajador_id INT REFERENCES trabajador(id),
    observacion TEXT
);
CREATE INDEX idx_pesaje_animal_fecha ON pesaje(animal_id, fecha);

-- ---------------------------------------------------------
-- 6.1 PRODUCCIÓN DE LECHE (registro de ordeño por animal)
-- ---------------------------------------------------------
CREATE TABLE produccion_leche (
    id              SERIAL PRIMARY KEY,
    animal_id       INT NOT NULL REFERENCES animal(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    turno           VARCHAR(10) NOT NULL DEFAULT 'unico' CHECK (turno IN ('manana','tarde','unico')),
    litros          DECIMAL(6,2) NOT NULL CHECK (litros >= 0),
    trabajador_id   INT REFERENCES trabajador(id),
    observacion     TEXT,
    UNIQUE (animal_id, fecha, turno)
);
CREATE INDEX idx_leche_animal_fecha ON produccion_leche(animal_id, fecha);

-- ---------------------------------------------------------
-- 6.2 HISTORIAL DE CATEGORÍA / ETAPA PRODUCTIVA
-- ---------------------------------------------------------
CREATE TABLE historial_categoria (
    id                  SERIAL PRIMARY KEY,
    animal_id           INT NOT NULL REFERENCES animal(id),
    categoria_anterior  VARCHAR(20),
    categoria_nueva     VARCHAR(20) NOT NULL,
    fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
    motivo              TEXT,
    trabajador_id       INT REFERENCES trabajador(id)
);
CREATE INDEX idx_historial_categoria_animal ON historial_categoria(animal_id);

-- ---------------------------------------------------------
-- 6.3 CONDICIÓN CORPORAL (escala estándar 1 a 5)
-- ---------------------------------------------------------
CREATE TABLE condicion_corporal (
    id              SERIAL PRIMARY KEY,
    animal_id       INT NOT NULL REFERENCES animal(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    puntuacion      SMALLINT NOT NULL CHECK (puntuacion BETWEEN 1 AND 5),
    observacion     TEXT,
    trabajador_id   INT REFERENCES trabajador(id)
);
CREATE INDEX idx_condicion_animal_fecha ON condicion_corporal(animal_id, fecha);

-- ---------------------------------------------------------
-- 6.4 BITÁCORA DE NOTAS ENTRE TRABAJADORES (diario del animal)
-- ---------------------------------------------------------
CREATE TABLE nota_seguimiento (
    id          SERIAL PRIMARY KEY,
    animal_id   INT NOT NULL REFERENCES animal(id),
    usuario_id  INT REFERENCES usuario(id),
    tag         VARCHAR(30),
    contenido   TEXT NOT NULL,
    fecha       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_nota_animal ON nota_seguimiento(animal_id, fecha);

-- ---------------------------------------------------------
-- 6.5 CONFIGURACIÓN DEL SISTEMA (umbrales ajustables)
-- ---------------------------------------------------------
CREATE TABLE configuracion (
    clave       VARCHAR(50) PRIMARY KEY,
    valor       NUMERIC NOT NULL,
    descripcion TEXT NOT NULL
);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('dias_alerta_vacuna', 30, 'Con cuántos días de anticipación avisar de una vacuna/dosis próxima'),
    ('dias_alerta_parto', 30, 'Con cuántos días de anticipación avisar de un parto estimado próximo'),
    ('pct_corral_casi_lleno', 90, 'Porcentaje de ocupación a partir del cual un corral se marca como "casi lleno"'),
    ('dias_sin_pesaje_alerta', 60, 'Días sin pesaje antes de recomendar pesar a un animal'),
    ('dias_sin_ordeno_alerta', 3, 'Días sin registro de ordeño antes de generar una alerta'),
    ('pct_caida_leche_alerta', 15, 'Porcentaje de caída en producción de leche (semana vs semana anterior) que dispara una alerta'),
    ('ganancia_diaria_minima_kg', 0.3, 'Ganancia de peso diaria (kg/día) por debajo de la cual se alerta baja ganancia'),
    ('precio_leche_litro', 0, 'Precio por litro de leche (para estimar ingresos en el reporte de rentabilidad; déjalo en 0 si no quieres valorar la leche)'),
    ('ubicacion_lat', 19.4326, 'Latitud del rancho (para consultar el clima) — obténla con clic derecho en Google Maps'),
    ('ubicacion_lon', -99.1332, 'Longitud del rancho (para consultar el clima) — obténla con clic derecho en Google Maps'),
    ('funcion_ia_activa', 0, 'Muestra el asistente de IA (chat flotante y resúmenes)'),
    ('funcion_clima_activa', 0, 'Muestra el panel de clima en Inicio'),
    ('funcion_calendario_activa', 0, 'Muestra la sección de Calendario'),
    ('funcion_listas_imprimibles_activa', 0, 'Muestra la sección de Listas imprimibles'),
    ('funcion_genealogia_activa', 0, 'Muestra la pestaña de Árbol genealógico en el seguimiento'),
    ('funcion_finanzas_activa', 0, 'Muestra las secciones de Finanzas y Gastos generales'),
    ('funcion_qr_activa', 0, 'Muestra los códigos QR (individual y etiquetas para imprimir)'),
    ('funcion_historial_tercero_activa', 0, 'Muestra el historial filtrado por proveedor/comprador'),
    ('max_intentos_login', 5, 'Intentos fallidos de inicio de sesión antes de bloquear la cuenta'),
    ('minutos_bloqueo_login', 15, 'Minutos que dura el bloqueo automático de una cuenta tras exceder los intentos fallidos'),
    ('dias_ventana_brote_ia', 45, 'Días hacia atrás que se revisan para reconstruir qué animales compartieron corral (ventana de contacto para detectar posibles brotes)'),
    ('min_afectados_cluster_brote', 2, 'Mínimo de animales enfermos/en observación dentro de un mismo clúster de contacto para considerarlo un posible brote'),
    ('hora_corte_diario', 22, 'Hora del día (0-23) a la que se manda automáticamente el resumen de bitácora por correo a los administradores');

-- ---------------------------------------------------------
-- 6.6 PLANTILLAS DE PLAN SANITARIO
-- ---------------------------------------------------------
-- (definidas más abajo, después de la tabla "insumo", de la que dependen)

-- ---------------------------------------------------------
-- 7. INVENTARIO DE INSUMOS (alimento, medicamentos)
-- ---------------------------------------------------------
CREATE TABLE insumo (
    id                  SERIAL PRIMARY KEY,
    nombre              VARCHAR(150) NOT NULL,
    tipo                VARCHAR(20) NOT NULL CHECK (tipo IN ('alimento','medicamento','vacuna','otro')),
    unidad_medida       VARCHAR(20) NOT NULL, -- kg, litros, dosis
    stock_actual        DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
    stock_minimo        DECIMAL(10,2) NOT NULL DEFAULT 0,
    fecha_caducidad     DATE
);

-- ---------------------------------------------------------
-- 6.6 PLANTILLAS DE PLAN SANITARIO (van aquí porque dependen de "insumo")
-- ---------------------------------------------------------
CREATE TABLE plan_sanitario (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(150) NOT NULL,
    descripcion TEXT,
    activo      BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE plan_sanitario_item (
    id              SERIAL PRIMARY KEY,
    plan_id         INT NOT NULL REFERENCES plan_sanitario(id) ON DELETE CASCADE,
    nombre_evento   VARCHAR(150) NOT NULL,
    tipo            VARCHAR(20) NOT NULL DEFAULT 'vacuna' CHECK (tipo IN ('vacuna','tratamiento','desparasitacion')),
    insumo_id       INT REFERENCES insumo(id),
    edad_dias       INT NOT NULL CHECK (edad_dias >= 0),
    descripcion     TEXT
);
CREATE INDEX idx_plan_item_plan ON plan_sanitario_item(plan_id);

CREATE TABLE animal_plan_sanitario (
    id                  SERIAL PRIMARY KEY,
    animal_id           INT NOT NULL REFERENCES animal(id),
    plan_id             INT NOT NULL REFERENCES plan_sanitario(id) ON DELETE CASCADE,
    fecha_asignacion    DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE (animal_id, plan_id)
);
CREATE INDEX idx_animal_plan_animal ON animal_plan_sanitario(animal_id);

-- ---------------------------------------------------------
-- 6.7 GASTOS GENERALES DEL RANCHO (no ligados a un animal específico)
-- ---------------------------------------------------------
CREATE TABLE categoria_gasto (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(80) UNIQUE NOT NULL
);

INSERT INTO categoria_gasto (nombre) VALUES
    ('Veterinario'), ('Electricidad'), ('Combustible'), ('Mano de obra'),
    ('Mantenimiento'), ('Renta de terreno'), ('Impuestos'), ('Otro');

CREATE TABLE gasto_general (
    id                  SERIAL PRIMARY KEY,
    categoria_id        INT NOT NULL REFERENCES categoria_gasto(id),
    fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
    monto               DECIMAL(12,2) NOT NULL CHECK (monto >= 0),
    descripcion         TEXT,
    corral_id           INT REFERENCES corral(id),
    comprobante_folio   VARCHAR(100),
    usuario_id          INT REFERENCES usuario(id)
);
CREATE INDEX idx_gasto_fecha ON gasto_general(fecha);
CREATE INDEX idx_gasto_categoria ON gasto_general(categoria_id);

-- ---------------------------------------------------------
-- 6.8 MÓDULOS ACTIVABLES/DESACTIVABLES
-- (para que un cliente nuevo empiece con lo básico, y el
--  Administrador vaya activando el resto cuando esté listo)
-- ---------------------------------------------------------
CREATE TABLE modulo_sistema (
    clave   VARCHAR(50) PRIMARY KEY,
    nombre  VARCHAR(100) NOT NULL,
    activo  BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO modulo_sistema (clave, nombre, activo) VALUES
    ('lote', 'Trabajo por lote', false),
    ('planes-sanitarios', 'Planes sanitarios', false),
    ('calendario', 'Calendario', false),
    ('listas', 'Listas imprimibles', false),
    ('gastos', 'Gastos generales', false),
    ('finanzas', 'Finanzas', false),
    ('genealogia', 'Árbol genealógico', false),
    ('ia', 'Asistente de IA', false);

-- ---------------------------------------------------------
-- 8. ALIMENTACIÓN (registro por animal o por corral/lote)
-- ---------------------------------------------------------
CREATE TABLE alimentacion (
    id              SERIAL PRIMARY KEY,
    animal_id       INT REFERENCES animal(id),      -- puede ser NULL si se registra por corral/lote
    corral_id       INT REFERENCES corral(id),
    insumo_id       INT NOT NULL REFERENCES insumo(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    cantidad        DECIMAL(10,2) NOT NULL CHECK (cantidad > 0),
    trabajador_id   INT REFERENCES trabajador(id),

    -- debe referirse a un animal O a un corral, no ambos vacíos
    CHECK (animal_id IS NOT NULL OR corral_id IS NOT NULL)
);
CREATE INDEX idx_alimentacion_animal ON alimentacion(animal_id, fecha);

-- ---------------------------------------------------------
-- 9. SALUD (vacunas, tratamientos, diagnósticos) — por animal
-- ---------------------------------------------------------
CREATE TABLE evento_salud (
    id              SERIAL PRIMARY KEY,
    animal_id       INT NOT NULL REFERENCES animal(id),
    tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('vacuna','tratamiento','diagnostico','desparasitacion')),
    insumo_id       INT REFERENCES insumo(id),        -- vacuna/medicamento usado
    enfermedad      VARCHAR(150),
    descripcion     TEXT,
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    proxima_dosis   DATE,                              -- para alertas de refuerzo
    veterinario_id  INT REFERENCES trabajador(id),
    plan_item_id    INT REFERENCES plan_sanitario_item(id) -- si este evento cumple un ítem de un plan sanitario
    -- Nota: la validación de que "fecha" no sea anterior al nacimiento del
    -- animal se implementa como TRIGGER más abajo (verificar_fecha_posterior_nacimiento),
    -- ya que un CHECK no puede consultar otra tabla.
);

CREATE INDEX idx_salud_animal_fecha ON evento_salud(animal_id, fecha);
CREATE INDEX idx_salud_proxima_dosis ON evento_salud(proxima_dosis);

-- ---------------------------------------------------------
-- 10. REPRODUCCIÓN (monta/inseminación → parto)
-- ---------------------------------------------------------
CREATE TABLE evento_reproductivo (
    id                  SERIAL PRIMARY KEY,
    madre_id            INT NOT NULL REFERENCES animal(id),
    padre_id            INT REFERENCES animal(id),
    tipo_monta          VARCHAR(30) NOT NULL CHECK (tipo_monta IN ('natural','inseminacion_artificial')),
    fecha_monta         DATE NOT NULL,
    fecha_parto_estimada DATE,
    fecha_parto_real    DATE,
    cria_id             INT REFERENCES animal(id),      -- se enlaza al nacer
    resultado           VARCHAR(20) DEFAULT 'pendiente'
                            CHECK (resultado IN ('pendiente','exitoso','aborto','vacio')),

    CHECK (madre_id <> padre_id)
);
CREATE INDEX idx_reproduccion_madre ON evento_reproductivo(madre_id);

-- ---------------------------------------------------------
-- 11. TERCEROS: PROVEEDORES Y COMPRADORES
-- ---------------------------------------------------------
CREATE TABLE tercero (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(150) NOT NULL,
    tipo        VARCHAR(20) NOT NULL CHECK (tipo IN ('proveedor','comprador','ambos')),
    contacto    VARCHAR(150),
    rfc_nif     VARCHAR(50) -- para facturación electrónica
);

-- ---------------------------------------------------------
-- 12. VENTAS Y COMPRAS (por animal)
-- ---------------------------------------------------------
CREATE TABLE venta_lote (
    id              SERIAL PRIMARY KEY,
    tercero_id      INT NOT NULL REFERENCES tercero(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    precio_total    DECIMAL(12,2) NOT NULL CHECK (precio_total >= 0),
    factura_folio   VARCHAR(100)
);

CREATE TABLE venta (
    id          SERIAL PRIMARY KEY,
    animal_id   INT NOT NULL UNIQUE REFERENCES animal(id), -- un animal se vende una vez
    tercero_id  INT NOT NULL REFERENCES tercero(id),
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    precio      DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
    factura_folio VARCHAR(100), -- referencia a facturación electrónica (CFDI, etc.)
    venta_lote_id INT REFERENCES venta_lote(id) -- si esta venta fue parte de un trato de varios animales
);

CREATE TABLE compra_animal (
    id              SERIAL PRIMARY KEY,
    animal_id       INT NOT NULL UNIQUE REFERENCES animal(id),
    tercero_id      INT NOT NULL REFERENCES tercero(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    precio          DECIMAL(10,2) CHECK (precio >= 0),
    identificacion_previa VARCHAR(50) -- arete/ID de la explotación de origen
);

CREATE TABLE compra_insumo (
    id              SERIAL PRIMARY KEY,
    insumo_id       INT NOT NULL REFERENCES insumo(id),
    tercero_id      INT NOT NULL REFERENCES tercero(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    cantidad        DECIMAL(10,2) NOT NULL CHECK (cantidad > 0),
    costo_total     DECIMAL(10,2) CHECK (costo_total >= 0)
);

-- ---------------------------------------------------------
-- 13. ASIGNACIÓN DE TAREAS
-- ---------------------------------------------------------
CREATE TABLE asignacion_tarea (
    id              SERIAL PRIMARY KEY,
    trabajador_id   INT NOT NULL REFERENCES trabajador(id),
    corral_id       INT REFERENCES corral(id),
    descripcion     VARCHAR(255) NOT NULL,
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    completada      BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------
-- 14. BITÁCORA / AUDITORÍA (inmutable)
-- ---------------------------------------------------------
CREATE TABLE bitacora (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  INT REFERENCES usuario(id),
    accion      VARCHAR(100) NOT NULL,   -- ej: 'crear_animal', 'login', 'editar_venta'
    entidad     VARCHAR(50),             -- tabla afectada
    entidad_id  INT,
    detalle     JSONB,                   -- payload flexible (antes/después)
    fecha       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_bitacora_fecha ON bitacora(fecha);
CREATE INDEX idx_bitacora_entidad ON bitacora(entidad, entidad_id);

-- Registro de qué días ya se mandó el corte diario de bitácora por correo
-- (evita reenvíos duplicados del job automático, y le dice al frontend
-- qué mostrar en cada encabezado de día).
CREATE TABLE corte_diario_bitacora (
    id             SERIAL PRIMARY KEY,
    fecha          DATE UNIQUE NOT NULL,
    enviado_en     TIMESTAMP NOT NULL DEFAULT now(),
    total_eventos  INT NOT NULL,
    destinatarios  INT NOT NULL,
    enviado_por    INT REFERENCES usuario(id)  -- NULL = automático; id del admin si fue manual
);

-- ---------------------------------------------------------
-- 15. ALERTAS (generadas por el sistema)
-- ---------------------------------------------------------
CREATE TABLE alerta (
    id          SERIAL PRIMARY KEY,
    tipo        VARCHAR(50) NOT NULL, -- vacuna_proxima, corral_sobrecupo, stock_bajo, parto_proximo
    entidad     VARCHAR(50),
    entidad_id  INT,
    mensaje     TEXT NOT NULL,
    atendida    BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en   TIMESTAMP NOT NULL DEFAULT now()
);

-- =========================================================
-- TRIGGERS Y FUNCIONES DE REGLAS DE NEGOCIO
-- =========================================================

-- 1) No exceder capacidad de corral al asignar/trasladar animal
CREATE OR REPLACE FUNCTION verificar_capacidad_corral()
RETURNS TRIGGER AS $$
DECLARE
    ocupacion_actual INT;
    capacidad INT;
BEGIN
    SELECT capacidad_maxima INTO capacidad FROM corral WHERE id = NEW.corral_actual_id;

    SELECT COUNT(*) INTO ocupacion_actual
    FROM animal
    WHERE corral_actual_id = NEW.corral_actual_id
      AND estado = 'vivo'
      AND id <> COALESCE(NEW.id, -1);

    IF ocupacion_actual >= capacidad THEN
        RAISE EXCEPTION 'El corral % ya alcanzó su capacidad máxima (%).', NEW.corral_actual_id, capacidad;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verificar_capacidad_corral
BEFORE INSERT OR UPDATE OF corral_actual_id ON animal
FOR EACH ROW
WHEN (NEW.corral_actual_id IS NOT NULL)
EXECUTE FUNCTION verificar_capacidad_corral();

-- 2) No permitir eventos de salud/pesaje con fecha anterior al nacimiento
CREATE OR REPLACE FUNCTION verificar_fecha_posterior_nacimiento()
RETURNS TRIGGER AS $$
DECLARE
    nacimiento DATE;
BEGIN
    SELECT fecha_nacimiento INTO nacimiento FROM animal WHERE id = NEW.animal_id;

    IF nacimiento IS NOT NULL AND NEW.fecha < nacimiento THEN
        RAISE EXCEPTION 'La fecha (%) no puede ser anterior al nacimiento del animal (%).', NEW.fecha, nacimiento;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_salud_fecha_valida
BEFORE INSERT OR UPDATE ON evento_salud
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_posterior_nacimiento();

CREATE TRIGGER trg_pesaje_fecha_valida
BEFORE INSERT OR UPDATE ON pesaje
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_posterior_nacimiento();

-- 3) No descontar más insumo del que hay en stock (alimentación)
CREATE OR REPLACE FUNCTION descontar_stock_alimentacion()
RETURNS TRIGGER AS $$
DECLARE
    disponible DECIMAL(10,2);
BEGIN
    SELECT stock_actual INTO disponible FROM insumo WHERE id = NEW.insumo_id;

    IF disponible < NEW.cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente del insumo % (disponible: %, solicitado: %).',
            NEW.insumo_id, disponible, NEW.cantidad;
    END IF;

    UPDATE insumo SET stock_actual = stock_actual - NEW.cantidad WHERE id = NEW.insumo_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_alimentacion_stock
BEFORE INSERT ON alimentacion
FOR EACH ROW EXECUTE FUNCTION descontar_stock_alimentacion();

-- 4) Registrar automáticamente el movimiento de corral cuando cambia corral_actual_id
CREATE OR REPLACE FUNCTION registrar_movimiento_corral()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND NEW.corral_actual_id IS DISTINCT FROM OLD.corral_actual_id)
       OR (TG_OP = 'INSERT' AND NEW.corral_actual_id IS NOT NULL) THEN
        INSERT INTO movimiento_corral (animal_id, corral_origen, corral_destino, motivo)
        VALUES (
            NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.corral_actual_id ELSE NULL END,
            NEW.corral_actual_id,
            CASE WHEN TG_OP = 'INSERT' THEN 'ingreso_inicial' ELSE 'traslado' END
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_animal_movimiento
AFTER INSERT OR UPDATE OF corral_actual_id ON animal
FOR EACH ROW EXECUTE FUNCTION registrar_movimiento_corral();

-- 5) No permitir fechas futuras en pesajes, salud y alimentación
CREATE OR REPLACE FUNCTION verificar_fecha_no_futura()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.fecha > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha (%) no puede ser futura.', NEW.fecha;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pesaje_fecha_no_futura
BEFORE INSERT OR UPDATE ON pesaje
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

CREATE TRIGGER trg_salud_fecha_no_futura
BEFORE INSERT OR UPDATE ON evento_salud
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

CREATE TRIGGER trg_alimentacion_fecha_no_futura
BEFORE INSERT OR UPDATE ON alimentacion
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

CREATE TRIGGER trg_leche_fecha_no_futura
BEFORE INSERT OR UPDATE ON produccion_leche
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

CREATE TRIGGER trg_leche_fecha_valida
BEFORE INSERT OR UPDATE ON produccion_leche
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_posterior_nacimiento();

CREATE TRIGGER trg_condicion_fecha_no_futura
BEFORE INSERT OR UPDATE ON condicion_corporal
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

CREATE TRIGGER trg_condicion_fecha_valida
BEFORE INSERT OR UPDATE ON condicion_corporal
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_posterior_nacimiento();

CREATE TRIGGER trg_gasto_fecha_no_futura
BEFORE INSERT OR UPDATE ON gasto_general
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

-- 6) No permitir usar un insumo ya caducado
CREATE OR REPLACE FUNCTION verificar_insumo_no_caducado()
RETURNS TRIGGER AS $$
DECLARE
    caducidad DATE;
    nombre_insumo VARCHAR;
BEGIN
    IF NEW.insumo_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT fecha_caducidad, nombre INTO caducidad, nombre_insumo FROM insumo WHERE id = NEW.insumo_id;
    IF caducidad IS NOT NULL AND caducidad < NEW.fecha THEN
        RAISE EXCEPTION 'El insumo "%" está caducado desde el % y no puede usarse.', nombre_insumo, caducidad;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_salud_insumo_no_caducado
BEFORE INSERT OR UPDATE ON evento_salud
FOR EACH ROW EXECUTE FUNCTION verificar_insumo_no_caducado();

CREATE TRIGGER trg_alimentacion_insumo_no_caducado
BEFORE INSERT OR UPDATE ON alimentacion
FOR EACH ROW EXECUTE FUNCTION verificar_insumo_no_caducado();

-- 7) No permitir reducir la capacidad de un corral por debajo de su ocupación actual
CREATE OR REPLACE FUNCTION verificar_capacidad_corral_editado()
RETURNS TRIGGER AS $$
DECLARE
    ocupacion_actual INT;
BEGIN
    IF NEW.capacidad_maxima < OLD.capacidad_maxima THEN
        SELECT COUNT(*) INTO ocupacion_actual FROM animal WHERE corral_actual_id = NEW.id AND estado = 'vivo';
        IF ocupacion_actual > NEW.capacidad_maxima THEN
            RAISE EXCEPTION 'No se puede reducir la capacidad a % porque el corral ya tiene % animales.', NEW.capacidad_maxima, ocupacion_actual;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_corral_capacidad_editada
BEFORE UPDATE OF capacidad_maxima ON corral
FOR EACH ROW EXECUTE FUNCTION verificar_capacidad_corral_editado();

-- 8) No permitir fechas futuras en las fechas propias del animal
-- (nacimiento, baja, inicio de estado de salud). No reutiliza
-- verificar_fecha_no_futura() porque esa función espera una columna
-- "fecha", y aquí son tres columnas con nombre propio.
CREATE OR REPLACE FUNCTION verificar_fechas_animal_no_futuras()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.fecha_nacimiento IS NOT NULL AND NEW.fecha_nacimiento > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha de nacimiento (%) no puede ser futura.', NEW.fecha_nacimiento;
    END IF;
    IF NEW.fecha_baja IS NOT NULL AND NEW.fecha_baja > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha de baja (%) no puede ser futura.', NEW.fecha_baja;
    END IF;
    IF NEW.salud_fecha_inicio IS NOT NULL AND NEW.salud_fecha_inicio > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha de inicio del estado de salud (%) no puede ser futura.', NEW.salud_fecha_inicio;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_animal_fechas_no_futuras
BEFORE INSERT OR UPDATE ON animal
FOR EACH ROW EXECUTE FUNCTION verificar_fechas_animal_no_futuras();

-- =========================================================
-- VISTA: FICHA / HISTORIAL COMPLETO DE UN ANIMAL
-- (resumen rápido para dashboards; el detalle línea por línea
--  se arma en el backend combinando las tablas relacionadas)
-- =========================================================
CREATE VIEW vista_ficha_animal AS
SELECT
    a.id,
    a.arete_id,
    a.nombre_alias,
    a.sexo,
    a.fecha_nacimiento,
    a.foto_url,
    r.nombre AS raza,
    a.estado,
    c.nombre AS corral_actual,
    (SELECT peso_kg FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1) AS ultimo_peso_kg,
    (SELECT fecha FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1) AS fecha_ultimo_pesaje,
    (SELECT COUNT(*) FROM evento_salud s WHERE s.animal_id = a.id) AS total_eventos_salud,
    (SELECT COUNT(*) FROM evento_reproductivo er WHERE er.madre_id = a.id) AS total_eventos_reproductivos,
    a.estado_salud,
    a.categoria
FROM animal a
LEFT JOIN raza r ON r.id = a.raza_id
LEFT JOIN corral c ON c.id = a.corral_actual_id;
