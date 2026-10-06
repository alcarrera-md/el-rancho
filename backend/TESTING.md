# Pruebas del backend

El backend usa el runner nativo `node:test` y `supertest` para probar Express
sin abrir un puerto ni iniciar el cron del corte diario.

## Configurar PostgreSQL de pruebas

1. Copia `.env.test.example` como `.env.test`.
2. Ajusta las credenciales, conservando una base cuyo nombre incluya `test`.
3. Crea la base aislada una sola vez:

   ```bash
   npm run test-db:create
   ```

La creación conecta primero a la base administrativa `postgres` usando
exclusivamente las credenciales de `TEST_DATABASE_URL`. Nunca toma
`DATABASE_URL` como alternativa.

## Ejecutar pruebas

```bash
cd backend
npm test
```

`npm test` ejecuta primero las pruebas unitarias. Después reinicializa
exclusivamente `sistema_ganadero_test` con `database/schema.sql` y los fixtures
de prueba, y finalmente ejecuta las pruebas de integración.

También pueden ejecutarse por separado:

```bash
npm run test:unit
npm run test:integration
npm run test-db:reset
```

## Protección para futuras pruebas de integración

Toda prueba que necesite PostgreSQL debe llamar primero a
`validarTestDatabaseUrl()`. La función exige que:

- exista `TEST_DATABASE_URL`;
- sea una URL PostgreSQL válida;
- el nombre de la base incluya `test`;
- no sea la misma conexión configurada en `DATABASE_URL`.

Ejemplo seguro:

```text
TEST_DATABASE_URL=postgres://postgres:clave@localhost:5432/sistema_ganadero_test
```

`test-db:reset` elimina y reconstruye el esquema `public` de la base de pruebas.
La operación aborta antes de ejecutar SQL si falta la URL, si el nombre no
contiene `test` o si apunta a la misma base que `DATABASE_URL`.

## Probar el runner de migraciones

La suite de integración también valida inicialización limpia, baseline de una
instalación existente, checksums, advisory lock, ejecución repetible y estado
de solo lectura. Las pruebas reconstruyen únicamente `sistema_ganadero_test`.

La documentación operativa del runner está en `database/migrations/README.md`.
