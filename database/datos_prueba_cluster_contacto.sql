-- =========================================================
-- DATOS DE PRUEBA: clúster de contacto transitivo (posible brote)
-- Pensado para probar GET /api/alertas/hato y POST
-- /api/alertas/hato/analisis-ia con un caso donde el contagio NO es
-- directo: A tuvo contacto con B, B tuvo contacto con C, pero A y C
-- nunca compartieron corral. La detección debe agruparlos igual, por
-- componentes conexas del grafo de contacto (ver backend/src/clusterContacto.js).
--
-- Se puede pegar y ejecutar de una sola vez en el Query Tool de pgAdmin.
-- Usa aretes nuevos (MX-3001 a MX-3003) para no chocar con los animales
-- de seed.sql (MX-0001, MX-0002) ni de datos_prueba_completos.sql (MX-2001+).
-- =========================================================

-- ---------------------------------------------------------
-- 1) Corrales necesarios. "Corral Becerros" y "Corral Toros" ya existen
--    si corriste datos_prueba_completos.sql — el ON CONFLICT hace que
--    este script se pueda correr de todas formas sin duplicarlos.
--    "Corral Rodeo" es nuevo, para el segundo tramo de la cadena.
-- ---------------------------------------------------------
INSERT INTO corral (nombre, descripcion, capacidad_maxima) VALUES
  ('Corral Becerros', 'Crías recién nacidas', 15)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO corral (nombre, descripcion, capacidad_maxima) VALUES
  ('Corral Toros', 'Machos reproductores', 8)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO corral (nombre, descripcion, capacidad_maxima) VALUES
  ('Corral Rodeo', 'Corral de manejo general', 12)
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------
-- 2) Los tres animales, sanos al nacer/ingresar. Cada uno arranca
--    directo en su primer corral (el trigger trg_animal_movimiento
--    genera automáticamente el primer renglón en movimiento_corral,
--    con motivo "ingreso_inicial" y fecha = hoy — lo recorremos más
--    abajo para dejarlo con la fecha histórica que necesitamos).
-- ---------------------------------------------------------

-- A: entra a Becerros hace 20 días
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, categoria, corral_actual_id)
VALUES ('MX-3001', 'Prueba A', 'hembra', CURRENT_DATE - INTERVAL '2 years', 'vientre',
        (SELECT id FROM corral WHERE nombre = 'Corral Becerros'));

-- B: ya estaba en Becerros desde antes de que A llegara (hace 30 días)
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, categoria, corral_actual_id)
VALUES ('MX-3002', 'Prueba B', 'hembra', CURRENT_DATE - INTERVAL '2 years', 'vientre',
        (SELECT id FROM corral WHERE nombre = 'Corral Becerros'));

-- C: entra directo a Rodeo hace 15 días (nunca pisa Becerros ni Toros)
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, categoria, corral_actual_id)
VALUES ('MX-3003', 'Prueba C', 'hembra', CURRENT_DATE - INTERVAL '2 years', 'vientre',
        (SELECT id FROM corral WHERE nombre = 'Corral Rodeo'));

-- ---------------------------------------------------------
-- 3) Recorremos las fechas de ingreso inicial a la línea de tiempo real:
--    B llegó a Becerros antes que A; C llegó a Rodeo antes que B.
-- ---------------------------------------------------------
UPDATE movimiento_corral SET fecha = CURRENT_DATE - INTERVAL '20 days'
WHERE id = (SELECT id FROM movimiento_corral
            WHERE animal_id = (SELECT id FROM animal WHERE arete_id = 'MX-3001')
            ORDER BY id DESC LIMIT 1);

UPDATE movimiento_corral SET fecha = CURRENT_DATE - INTERVAL '30 days'
WHERE id = (SELECT id FROM movimiento_corral
            WHERE animal_id = (SELECT id FROM animal WHERE arete_id = 'MX-3002')
            ORDER BY id DESC LIMIT 1);

UPDATE movimiento_corral SET fecha = CURRENT_DATE - INTERVAL '15 days'
WHERE id = (SELECT id FROM movimiento_corral
            WHERE animal_id = (SELECT id FROM animal WHERE arete_id = 'MX-3003')
            ORDER BY id DESC LIMIT 1);

-- ---------------------------------------------------------
-- 4) Los traslados que arman la cadena de contacto:
--    - A se mueve de Becerros a Toros hace 10 días → su estancia en
--      Becerros (día -20 a día -10) traslapa con la de B (que sigue ahí).
--    - B se mueve de Becerros a Rodeo hace 3 días → ahí se topa con C,
--      que ya llevaba 12 días en Rodeo. A nunca pisa Rodeo, así que A y C
--      jamás coinciden directamente — pero quedan en el mismo clúster
--      porque ambos tuvieron contacto (en momentos distintos) con B.
-- ---------------------------------------------------------
UPDATE animal SET corral_actual_id = (SELECT id FROM corral WHERE nombre = 'Corral Toros')
WHERE arete_id = 'MX-3001';

UPDATE movimiento_corral SET fecha = CURRENT_DATE - INTERVAL '10 days'
WHERE id = (SELECT id FROM movimiento_corral
            WHERE animal_id = (SELECT id FROM animal WHERE arete_id = 'MX-3001')
            ORDER BY id DESC LIMIT 1);

UPDATE animal SET corral_actual_id = (SELECT id FROM corral WHERE nombre = 'Corral Rodeo')
WHERE arete_id = 'MX-3002';

UPDATE movimiento_corral SET fecha = CURRENT_DATE - INTERVAL '3 days'
WHERE id = (SELECT id FROM movimiento_corral
            WHERE animal_id = (SELECT id FROM animal WHERE arete_id = 'MX-3002')
            ORDER BY id DESC LIMIT 1);

-- ---------------------------------------------------------
-- 5) A se marca enfermo — con inicio de síntomas después de su
--    contacto con B en Becerros (día -10), ya instalado en Toros.
--    B se marca "en observación" (contacto directo con A, síntomas
--    leves o dudosos) — así el clúster ya tiene 2 afectados y aparece
--    en GET /api/alertas/hato con el umbral por defecto
--    (min_afectados_cluster_brote = 2) sin tocar la configuración.
--    C se queda "sano": estuvo en riesgo por contacto con B, pero sin
--    ninguna señal — para ver el caso de "en riesgo pero sano todavía"
--    dentro del mismo clúster.
-- ---------------------------------------------------------
UPDATE animal SET
  estado_salud = 'enfermo',
  salud_fecha_inicio = CURRENT_DATE - INTERVAL '7 days',
  salud_diagnostico = 'Fiebre y diarrea — posible cuadro infeccioso (dato de prueba)',
  salud_tratamiento = 'En observación, pendiente de valorar por el veterinario'
WHERE arete_id = 'MX-3001';

UPDATE animal SET
  estado_salud = 'observacion',
  salud_fecha_inicio = CURRENT_DATE - INTERVAL '2 days'
WHERE arete_id = 'MX-3002';

-- ---------------------------------------------------------
-- Verificación rápida (opcional): así debería verse la línea de tiempo
-- de contacto que acabas de crear, antes de probar la API.
-- ---------------------------------------------------------
-- SELECT a.arete_id, a.nombre_alias, a.estado_salud, mc.fecha, co.nombre AS corral_destino
-- FROM movimiento_corral mc
-- JOIN animal a ON a.id = mc.animal_id
-- JOIN corral co ON co.id = mc.corral_destino
-- WHERE a.arete_id IN ('MX-3001','MX-3002','MX-3003')
-- ORDER BY a.arete_id, mc.fecha;
--
-- Resultado esperado en el sistema:
-- - GET /api/alertas/hato → un clúster con MX-3001, MX-3002 y MX-3003
--   juntos (A-B por Becerros, B-C por Rodeo), con 2 afectados (A enfermo,
--   B en observación) y C sano pero dentro del mismo grupo de contacto.
-- - POST /api/alertas/hato/analisis-ia con el id de MX-3001 (o de
--   cualquiera de los tres) debe devolver ese mismo grupo de 3 animales
--   y la cadena de contactos A-B / B-C para que Gemini la evalúe.
--
-- NOTA: si además quieres probar el caso "1 solo afectado" (para ver
-- que el umbral SÍ filtra clústeres débiles de la lista, aunque
-- POST /hato/analisis-ia los siga encontrando), deja a MX-3002 como
-- "sano" y corre la migración database/migracion_deteccion_brotes_ia.sql
-- (agrega min_afectados_cluster_brote y dias_ventana_brote_ia a
-- "configuracion", hoy solo existen como default en el código) — así
-- puedes bajar el umbral a 1 desde Configuración sin editar SQL a mano.
