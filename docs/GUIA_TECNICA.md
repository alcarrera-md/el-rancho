# Guía técnica — El Rancho

> Documento técnico para desarrolladores. La presentación general del proyecto
> está en el [README](../README.md).

Sistema completo con **React + Vite**, **Node.js + Express** y **PostgreSQL**.
Cada animal tiene una ficha con su historial de pesajes, salud, alimentación,
reproducción, leche, movimientos, condición corporal, cambios de categoría y
resultados económicos. El catálogo completo de funciones está en
[`FUNCIONALIDADES.md`](FUNCIONALIDADES.md).

## Estructura

```
sistema-ganadero/
├── database/
│   ├── schema.sql        -> esquema completo y baseline
│   ├── migrations/      -> migraciones versionadas nuevas
│   └── seed.sql          -> datos opcionales de demostración
├── backend/
│   ├── src/
│   │   ├── app.js           -> construcción de la aplicación Express
│   │   ├── server.js        -> puerto y tareas programadas
│   │   ├── db.js            -> conexión a PostgreSQL
│   │   ├── middleware/
│   │   └── routes/
│   │       ├── animales.js  -> CRUD + ficha/historial completo
│   │       ├── corrales.js
│   │       ├── pesajes.js
│   │       ├── salud.js
│   │       ├── alimentacion.js
│   │       ├── reproduccion.js
│   │       └── ventas.js
│   ├── package.json
│   ├── TESTING.md
│   ├── AUTHORIZATION.md
│   └── AUDITORIA.md
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js
        ├── styles.css
        └── components/
```

## 1. Base de datos y migraciones

Requiere PostgreSQL 13+.

El runner exige `MIGRATION_DATABASE_URL`; nunca toma `DATABASE_URL` como
alternativa. Para una instalación nueva, crea una base vacía y ejecuta desde
`backend/`:

```bash
npm run migrate:init
npm run migrate:status
```

Para una instalación histórica compatible usa `npm run migrate:baseline`, y
para aplicar nuevas versiones usa `npm run migrate:up`. El runner valida la
estructura antes del baseline, checksums, orden, transacciones y un advisory
lock. Consulta [`database/migrations/README.md`](../database/migrations/README.md).

### Decisiones de diseño clave

- **`animal` es la entidad central.** Todas las tablas de eventos
  (`pesaje`, `evento_salud`, `alimentacion`, `evento_reproductivo`,
  `movimiento_corral`) tienen un `animal_id` — así se puede reconstruir
  la ficha completa de cualquier animal.
- **Reglas de negocio como TRIGGERS**, no solo validación en el backend:
  - No se puede exceder la capacidad de un corral.
  - No se pueden registrar eventos de salud/pesaje con fecha anterior
    al nacimiento del animal.
  - La alimentación descuenta el stock automáticamente y rechaza la
    operación si no hay suficiente inventario.
  - Cada cambio de corral queda registrado automáticamente en
    `movimiento_corral` (no hace falta que el backend lo haga a mano).
- **`arete_id` es `UNIQUE`** para garantizar la identificación única exigida
  por normativas de trazabilidad.

## 2. Backend

```bash
cd backend
npm install
cp .env.example .env   # ajusta DATABASE_URL y JWT_SECRET
npm run dev            # o: npm start
```

El servidor corre en `http://localhost:3000` (o el puerto que definas en `.env`).

`src/app.js` construye Express sin abrir puertos; `src/server.js` inicia el
servidor y las tareas programadas. Esto permite probar la API con `supertest`.

### Pruebas

Configura `backend/.env.test` con una URL exclusiva cuyo nombre contenga
`test`, por ejemplo `sistema_ganadero_test`. La suite rechaza URLs ausentes,
no aisladas o iguales a la conexión de desarrollo.

```bash
cd backend
npm test
```

La suite cubre autenticación, validación, errores, permisos, PostgreSQL real,
migraciones, transacciones, concurrencia, operaciones por lote y auditoría.
Consulta [`backend/TESTING.md`](../backend/TESTING.md).

### Endpoint estrella: ficha completa de un animal

```
GET /api/animales/:id/historial
```

Devuelve en una sola respuesta:
- Datos generales del animal (arete, raza, padres, corral actual)
- Línea de tiempo unificada y ordenada cronológicamente con **todos**
  los eventos (pesajes, salud, alimentación, reproducción, movimientos)
- Resumen (totales, último peso registrado)
- Sus crías (si aplica) y su venta (si fue vendido)

Ejemplo con los datos de `seed.sql` (animal con `id=2`):

```bash
curl http://localhost:3000/api/animales/2/historial
```

### Otros endpoints principales

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/animales` | Lista animales (filtros: `estado`, `corral_id`, `q`) |
| POST | `/api/animales` | Alta de animal (nacimiento o ingreso externo) |
| PATCH | `/api/animales/:id/corral` | Trasladar animal de corral |
| PATCH | `/api/animales/:id/baja` | Marcar sacrificado/muerto (`vendido` exige una venta con registro comercial) |
| GET | `/api/corrales` | Lista corrales con ocupación actual |
| POST | `/api/pesajes` | Registrar un pesaje |
| POST | `/api/salud` | Registrar vacuna/tratamiento |
| GET | `/api/salud/proximas?dias=30` | Vacunas próximas a vencer (para alertas) |
| POST | `/api/alimentacion` | Registrar suministro de alimento (descuenta stock) |
| GET | `/api/alimentacion/stock-bajo` | Insumos por debajo del mínimo |
| POST | `/api/reproduccion` | Registrar monta/inseminación |
| PATCH | `/api/reproduccion/:id/parto` | Registrar parto y enlazar cría |
| POST | `/api/ventas` | Registrar venta (transacción: venta + baja de animal) |
| GET | `/api/ventas/reporte?desde=...&hasta=...` | Reporte de ingresos por ventas |

### Consistencia de operaciones compuestas

- La venta individual y la venta por lote son atómicas. La venta por lote bloquea todos los animales en orden por ID y falla completa si alguno no existe o no está vivo.
- `PATCH /api/animales/:id/baja` solo admite `muerto` y `sacrificado`. El estado `vendido` se obtiene exclusivamente mediante una venta válida, de modo que siempre exista el registro comercial correspondiente.
- La alimentación por lote conserva su comportamiento histórico de éxito parcial. Procesa los animales en el orden recibido, bloquea el insumo durante todo el lote y devuelve `creados`, `errores`, `consumo_total_requerido` y `consumo_total_aplicado`.
- La compra de insumos bloquea el insumo y registra la compra y el incremento de stock dentro de una única transacción.

### Seguridad, permisos y auditoría

- Los errores de aplicación tienen código estable y no filtran SQL, stacks,
  constraints ni detalles de conexión.
- Cada request autenticado recarga desde PostgreSQL el estado activo y rol
  actual; una desactivación o cambio de rol tiene efecto inmediato.
- La matriz ejecutable vive en `backend/src/authorization/policy.js` y está
  documentada en [`backend/AUTHORIZATION.md`](../backend/AUTHORIZATION.md).
- Las operaciones críticas escriben auditoría dentro de su transacción. Los
  eventos incluyen actor, rol, resultado y, cuando corresponde, estado
  anterior/posterior. Consulta [`backend/AUDITORIA.md`](../backend/AUDITORIA.md).

## 3. Frontend

Requiere que el backend (paso 2) esté corriendo en `http://localhost:3000`.

```bash
cd frontend
npm install
npm run dev
```

Abre en el navegador la dirección que te muestre (normalmente `http://localhost:5173`).

### Desarrollo en laptop y celular

El frontend consume `/api` y `/uploads` en el mismo origen. En desarrollo,
Vite los redirige al backend de `127.0.0.1:3000`; por eso un celular debe abrir
`http://IP_DE_LA_LAPTOP:5173` y nunca una URL que apunte a `localhost:3000`.

El puerto 5173 es estricto. Si ya existe otro Vite abierto, el segundo proceso
termina en vez de saltar silenciosamente a 5174 y dejar dos versiones distintas
en la laptop y el celular. Cierra el proceso anterior antes de reiniciar Vite.

Durante HMR, los módulos ya visitados se actualizan normalmente y los chunks no
visitados se compilan al abrir su ruta. Si una recompilación tiene un error 5xx,
la interfaz lo identifica como error de Vite; corrige el módulo y usa
**Reintentar sección**. Un 404/410 de un chunk indica que la pestaña conserva una
versión cuyo archivo ya no existe: prueba el reintento y, si persiste, usa
**Actualizar aplicación** para recargar el documento y su mapa de chunks.

`React.lazy` conserva una promesa rechazada. Por eso la navegación normal
mantiene tipos lazy estables y el botón de reintento crea una generación nueva;
la recarga completa queda como recuperación explícita para versiones obsoletas.

Si Dashboard reporta un fallo de `/api/asignaciones`, verifica primero
`npm run migrate:status`: la migración `0002_tareas_operativas` debe figurar
aplicada. No apliques ese SQL manualmente ni omitas el baseline.

### Qué incluye

- **Animales:** lista con búsqueda por arete/nombre y filtro por estado; botón para registrar un animal nuevo.
- **Ficha de animal:** al hacer clic en un animal, se abre su historial completo —
  la "bitácora" — con todos sus eventos (pesajes, salud, alimentación, movimientos)
  ordenados cronológicamente, más un resumen numérico.
- **Corrales:** ocupación actual de cada corral con barra visual (se pone roja
  al acercarse al límite).
- **Alertas:** vacunas próximas a vencer e insumos con stock bajo, alimentadas
  por los mismos endpoints de la API.

### Seguridad de archivos Excel

La importación y las exportaciones usan `read-excel-file` y
`write-excel-file`, cargados de forma diferida en el navegador. Solo se admite
el formato moderno `.xlsx`: los encabezados de la plantilla de animales deben
coincidir exactamente y los archivos mayores de **5 MB** se rechazan antes de
invocar el parser. El formato heredado `.xls` no está soportado.

## 4. Login y roles

Después de correr `database/seed.sql` (crea los roles) y `database/migracion_login.sql`
(crea el usuario Administrador inicial),
inicia sesión con:
- **Correo:** `admin@rancho.com`
- **Contraseña:** `CambiaEstaClave123` (cámbiala en cuanto entres, desde "Usuarios" → Restablecer clave)

### Los 4 roles

| Rol | Puede hacer |
|---|---|
| Administrador | Acceso completo, incluidos usuarios, trabajadores, configuración y operaciones financieras |
| Veterinario | Escritura clínica y reproductiva; pesajes, condición corporal, planes sanitarios, notas propias y finalización de tareas; lectura general |
| Trabajador | Operaciones de campo: animales, alimentación, pesajes, leche, condición corporal, notas propias y tareas; sin finanzas sensibles ni catálogos maestros |
| Auditor | Lectura operativa, financiera, reportes y bitácora; ninguna modificación de datos |

La matriz detallada y centralizada está en [`backend/AUTHORIZATION.md`](../backend/AUTHORIZATION.md).
El backend consulta en PostgreSQL el estado y rol actuales del usuario en cada solicitud;
el contenido del JWT no se usa como autoridad para permisos. El frontend puede ocultar
acciones por comodidad, pero esa visibilidad no sustituye la autorización del servidor.
