# Modo sin conexión (PWA) — diseño y contrato

## Alcance final

Offline Campo v1 ofrece un Inicio reducido y lectura local de Animales, Corrales y Tareas. El
bootstrap incluye además el catálogo mínimo de alimentos necesario para capturar consumos. Las
únicas escrituras offline son pesaje, nota, requiere revisión, completar tarea, alimentación y
movimiento de corral.

Quedan fuera fotografías, ventas, compras, finanzas, Background Sync y notificaciones push. Las
vistas totalmente online se sustituyen antes de cargar su módulo por **Esta sección necesita conexión**.
Seguimiento, Pesajes, Alimentación y Movimientos abren una superficie limitada basada únicamente
en el snapshot y reutilizan los mismos formularios y la misma cola; sus historiales continúan
disponibles sólo al recuperar conexión.

## Arquitectura y contrato de bootstrap

`GET /api/sync/bootstrap` devuelve el único contrato ejecutable vigente:
`offline-bootstrap.v3`. Incluye la identidad y `sesion_version` de la partición, hora del servidor,
animales vivos resumidos, corrales con capacidad/ocupación/actividad, tareas visibles para el rol e
insumos de tipo alimento activos o relevantes para captura. No descarga historiales completos,
finanzas, archivos ni secretos.

El cliente rechaza atómicamente un bootstrap si el esquema, propietario, `sesion_version`, fecha o
colecciones no coinciden. Solo después de validar todo reemplaza el snapshot del mismo usuario.
Las referencias a v1 y v2 en documentos de fases anteriores describen la historia del contrato;
ningún código de ejecución las acepta.

## Sesión y aislamiento

El modo offline se habilita únicamente con un snapshot del mismo `usuario_id`, un JWT conocido y
una ventana local vigente que nunca excede la expiración del JWT. Un 401/403 confirmado por el
servidor elimina el snapshot legible, pero conserva la cola particionada para que su propietario
pueda recuperarla al autenticarse otra vez. Un logout voluntario advierte sobre capturas sin
resolver y, si se confirma, elimina snapshot, pendientes, conflictos e historial de esa cuenta.

Las cuentas usan una sola contraseña definida por el Administrador o restablecida posteriormente;
ambas quedan utilizables inmediatamente. La columna histórica `requiere_cambio_password` se
conserva temporalmente por compatibilidad de datos, pero ya no controla middleware, login, rutas,
sesiones ni el arranque offline.

Todas las lecturas de IndexedDB requieren `usuario_id`. Antes de enviar, el sincronizador compara
además el propietario de la operación con el `id` declarado por el token activo. Un temporizador o
reintento perteneciente a A nunca puede emitir una petición usando la sesión de B.

## IndexedDB

La base `el-rancho-campo-v1` termina en versión 4:

1. v1: sesión, animales, corrales, tareas y metadata de sincronización;
2. v2: operaciones pendientes y conflictos, con índices por usuario/estado/fecha;
3. v3: historial local mínimo de confirmaciones;
4. v4: catálogo de insumos para alimentación.

Cada upgrade agrega almacenes y nunca elimina los anteriores. El reemplazo del bootstrap usa una
sola transacción sobre todas sus colecciones. Confirmar una operación mueve atómicamente la fila de
pendientes al historial. Una operación que quedó `sincronizando` por cierre abrupto vuelve a ser
elegible al abrir una nueva ronda, conservando su UUID.

## Idempotencia y sincronización

Cada captura se guarda con `client_operation_id` UUID, instalación, propietario, fecha local, tipo,
entidad, payload y contexto público mínimo. Al enviarla se usan `X-Offline-Operation`,
`Idempotency-Key`, `X-Client-Installation-Id` y `X-Client-Local-Timestamp`.

El backend reserva el recibo en `operacion_cliente` dentro de la misma transacción de negocio. La
misma cuenta y UUID con igual payload recuperan el resultado anterior; un payload diferente genera
`IDEMPOTENCY_KEY_REUSED`. Datos, historial de dominio, bitácora y recibo confirman o revierten
juntos. La cola se procesa en orden y una sola ronda por usuario; red, timeout y 5xx permanecen
pendientes con backoff. 403, 404 y 409 pasan a conflicto y nunca se sobrescriben automáticamente.

## Precondiciones y conflictos

- Tareas validan asignación, estado y versión monotónica.
- Alimentación bloquea el insumo y valida actividad, caducidad, unidad, stock y versión; para un
  animal valida también existencia, estado y corral observado.
- Movimientos bloquean animal y destino, validan estado, origen, versión, actividad y capacidad. El
  trigger de capacidad toma el mismo bloqueo para impedir que altas concurrentes excedan el cupo.
- Pesajes, notas y requiere revisión vuelven a validar las referencias en PostgreSQL; requiere
  revisión rechaza animales inactivos.
- La autorización central se evalúa nuevamente en cada petición.

El panel explica qué se intentó, qué cambió, por qué no se aplicó y qué hacer. Permite descartar o
volver a capturar cuando existe una ruta segura. Recapturar abre datos actuales y no reutiliza el
payload conflictivo.

## Recuperación ante fallos

- Cierre con operación pendiente: la fila persiste en IndexedDB.
- Cierre durante `sincronizando`: la próxima ronda reintenta el mismo UUID.
- PostgreSQL confirma y se pierde la respuesta: el cliente conserva el UUID y el backend devuelve
  el recibo previo sin repetir la escritura.
- Cierre con conflicto: el conflicto permanece separado de la cola hasta revisión o descarte.
- JWT vencido: no se envía nada; al volver Internet se exige autenticación y solo la misma cuenta
  puede procesar sus capturas.
- Falla de snapshot o IndexedDB: se muestra un mensaje controlado; con conectividad conocida como
  offline no se inicia un fetch de respaldo innecesario.

## Prueba manual reproducible

Usar exclusivamente una cuenta y animales/corrales de prueba:

1. Iniciar online, autenticar y abrir Configuración → Sincronización; confirmar bootstrap v3.
2. Desconectar la red y verificar Inicio reducido, Animales, Corrales y Tareas sin errores de fetch.
3. Registrar, en orden, pesaje, nota, requiere revisión, completar tarea, alimentación y movimiento.
4. Para cada captura confirmar **Guardado en este dispositivo** y **Pendiente de sincronización**;
   nunca un éxito del servidor.
5. Cerrar completamente la aplicación, abrir todavía offline y comprobar las seis pendientes.
6. A 390 px revisar que el panel cierre por botón/Escape/backdrop, formularios y botones sean
   táctiles, conflictos ajusten texto y no exista scroll horizontal ni controles flotantes tapando
   contenido.
7. Recuperar Internet. Si el JWT venció, iniciar sesión con la misma cuenta. Comprobar que otra
   cuenta no ve ni envía esas filas.
8. Sincronizar y consultar directamente API/PostgreSQL: un pesaje, una nota, estado de salud en
   observación, tarea completada una vez, un consumo/descuento y un movimiento/ubicación nuevos.
   Confirmar seis recibos, sus bitácoras, cola vacía e historial local de confirmaciones.
9. Repetir cada petición con su UUID para simular respuesta perdida: debe responder
   `Idempotency-Replayed: true` sin insertar, descontar, completar ni mover otra vez.
10. Preparar por separado conflictos de tarea modificada, animal inactivo/cambiado, stock cambiado,
    corral lleno/movido y permiso revocado. Verificar comprensión, ausencia de mutación, descarte y
    recaptura desde datos actuales.
