# Matriz de autorización del backend

La fuente ejecutable de esta matriz es `src/authorization/policy.js`. Las rutas no
declaran listas de roles: cada solicitud se traduce centralmente a un recurso y una
acción. Una combinación que no aparezca en la matriz se rechaza con HTTP 403.

Abreviaturas: **A** = Administrador, **V** = Veterinario, **T** = Trabajador,
**Au** = Auditor y **Todos** = A/V/T/Au.

| Recurso | GET | POST | PATCH/PUT | DELETE |
|---|---|---|---|---|
| Alertas | Todos | Todos, solo análisis sin persistencia | — | — |
| Alimentación | Todos | A/T | A/T | A/T |
| Animales e historial | Todos | A/T | A/T; baja solo A; estado clínico A/V; T solo puede reportar `observacion` | — |
| Asignaciones/tareas | Todos | A | A/V/T para completar | A |
| Asistente | — | Chat: Todos; resumen: A/V/T; confirmar cambios: A | — | — |
| Bitácora | A/Au | A, únicamente envío manual del corte | — | — |
| Calendario | Todos | — | — | — |
| Clima | Todos | — | — | — |
| Compras de animales | Todos | A | — | — |
| Compras de insumos | Todos | A | — | — |
| Condición corporal | Todos | A/V/T | A/V/T | A/V/T |
| Configuración no sensible | Todos | — | A | — |
| Corrales y movimientos | Todos | A | A | — |
| Destinatarios del corte diario | A | A | — | A |
| Gastos generales/categorías | Todos | A | A | A |
| Genealogía | Todos | — | — | — |
| Insumos | Todos | A | A | — |
| Módulos del sistema | Todos | — | A | — |
| Notas de seguimiento | Todos | A/V/T | — | A o autor V/T |
| Pesajes | Todos | A/V/T | A/V/T | A/V/T |
| Planes sanitarios | Todos | A/V | A/V | Plan: A; ítems/asignaciones: A/V |
| Producción de leche | Todos | A/T | A/T | A/T |
| Razas | Todos | A | — | — |
| Reportes, finanzas y rentabilidad | Todos | — | — | — |
| Reproducción | Todos | A/V | A/V | — |
| Salud | Todos | A/V | A/V | A/V |
| Terceros | Todos | A | A | — |
| Trabajadores | A | A | A | — |
| Usuarios y roles | A | A | A | — |
| Ventas | Todos | A | — | — |

## Autenticación vigente

- `POST /api/auth/login` es público.
- `GET /api/auth/me` exige un JWT válido y devuelve el usuario recargado desde PostgreSQL.
- Cada solicitud autenticada consulta `usuario.activo` y el rol relacionado en PostgreSQL.
- Una cuenta desactivada pierde acceso inmediatamente y un cambio de rol se aplica al siguiente request.
- `GET /api/health` permanece público y no expone datos del negocio.

## Reglas contextuales

- Un Trabajador solo puede usar el cambio de salud para enviar `estado_salud: "observacion"`
  sin diagnóstico, tratamiento ni fecha clínica. Las demás decisiones clínicas requieren A/V.
- Una nota solo puede eliminarse por su autor V/T o por A. Au nunca puede eliminarla.
- Los `POST` de chat y análisis de alertas son consultas computadas sin persistencia; no
  habilitan modificaciones a Au. Las acciones propuestas por el asistente solo las confirma A.
