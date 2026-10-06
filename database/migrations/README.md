# Migraciones versionadas

Esta carpeta contiene únicamente las migraciones creadas a partir de la etapa
de estabilización. Los SQL históricos del directorio `database/` se conservan
sin cambios y no se convierten retroactivamente.

## Convención

Cada archivo usa el formato:

```text
NNNN_nombre_descriptivo.sql
```

El runner calcula SHA-256 sobre el contenido normalizado a saltos de línea LF.
Nunca se debe editar, eliminar o renombrar una migración después de aplicarla.

## Variables

Todos los comandos requieren `MIGRATION_DATABASE_URL`. No se usa
`DATABASE_URL` como fallback.

```text
MIGRATION_DATABASE_URL=postgres://usuario:clave@localhost:5432/base_objetivo
```

## Instalación nueva

La base debe existir y estar vacía. El comando ejecuta `database/schema.sql`,
valida la estructura, crea `schema_migrations`, registra el baseline y aplica
las migraciones posteriores:

```bash
npm run migrate:init
```

## Instalación existente

Antes de registrar el baseline se comprueban las tablas, columnas y triggers
esenciales esperados. Si falta cualquiera, el comando aborta sin crear
`schema_migrations`:

```bash
npm run migrate:baseline
```

El baseline no ejecuta de nuevo `schema.sql` ni los SQL históricos.

## Consultar estado

```bash
npm run migrate:status
```

El estado abre una transacción `READ ONLY`; no crea tablas ni registra filas.

## Aplicar pendientes

```bash
npm run migrate:up
```

Cada archivo pendiente se ejecuta en su propia transacción. Un advisory lock
impide dos runners simultáneos. Si el checksum de una migración aplicada no
coincide con el archivo actual, el runner aborta.
