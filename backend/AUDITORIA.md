# Auditoría operativa

La tabla histórica `bitacora` conserva su esquema actual. Su columna `detalle JSONB` contiene un contrato versionado que permite incorporar trazabilidad sin alterar `database/schema.sql` ni las migraciones históricas.

## Contrato del evento

```json
{
  "version": 1,
  "resultado": "exito",
  "actor": { "rol": "Administrador" },
  "antes": {},
  "despues": {},
  "contexto": {}
}
```

La fila conserva además `usuario_id`, `accion`, `entidad`, `entidad_id` y `fecha`. `antes`, `despues` y `contexto` son opcionales. Los intentos de login rechazados usan `resultado: "fallo"`; para una identidad desconocida se guarda únicamente una huella corta irreversible del correo, nunca el correo y contraseña juntos.

## Garantías

- Las operaciones críticas de animales, ventas, compras, alimentación, salud, reproducción, pesajes, condición corporal, leche, corrales, insumos, trabajadores, configuración y usuarios escriben su evento antes del `COMMIT` y con el mismo cliente PostgreSQL.
- Un rollback no deja un evento de éxito y un fallo de auditoría revierte la operación crítica.
- Los lotes históricamente parciales (importación, salud, pesajes y alimentación) auditan cada elemento dentro de su propia transacción o savepoint.
- La función de saneamiento elimina recursivamente campos cuyos nombres indiquen contraseña, hash, token, JWT, secretos, claves API, SMTP o credenciales.
- Ninguna llamada a `registrarBitacora` es deliberadamente *fire-and-forget*: los errores se propagan al llamador.

## Consulta y acceso

`GET /api/bitacora` admite filtros por entidad, fechas, usuario, acción y texto. Administrador y Auditor pueden consultar; la matriz central impide modificaciones por parte del Auditor y de los demás roles.

## Límites conocidos

- El esquema no almacena IP, agente de usuario ni un identificador de correlación HTTP. Agregarlos requeriría una migración futura.
- El envío del corte diario incluye un efecto externo (correo) que PostgreSQL no puede revertir. El evento se espera, pero un fallo posterior no puede deshacer correos ya entregados.
- Algunas operaciones auxiliares no prioritarias conservan auditoría resumida y no siempre una instantánea completa; deben ampliarse cuando esos módulos entren en estabilización funcional.
