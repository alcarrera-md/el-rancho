# El Rancho — Funcionalidades

Catálogo de lo que hace el sistema, organizado por área. La guía técnica está en
[`GUIA_TECNICA.md`](GUIA_TECNICA.md).

## 1. Animales
- Ficha individual con foto, historial completo, exportable a PDF
- Alta individual y por **importación masiva desde Excel** (con plantilla descargable)
- Edición de datos, búsqueda y filtros
- **Estado de salud** (sano / en observación / enfermo) con diagnóstico y tratamiento
- **Categoría/etapa productiva** (cría, destete, engorde, vientre, reproductor, descarte) con historial de cambios
- Baja general únicamente por sacrificio o muerte; una venta siempre se registra mediante los endpoints comerciales
- **Genealogía**: madre/padre, árbol visual de ancestros y descendientes, **aviso de consanguinidad**

## 2. Espacio de seguimiento (por animal)
- Pantalla dedicada de pantalla completa, accesible con el botón de ojo
- **Recomendaciones automáticas** basadas en reglas reales (pesaje, salud, reproducción, leche, plan sanitario)
- Registro de pesaje, salud, alimentación, leche, condición corporal (escala 1-5), monta/parto
- **Diario de notas entre trabajadores** con tags de color
- **Rentabilidad estimada** del animal

## 3. Corrales
- Alta/edición, ocupación vs. capacidad con barra visual
- Reglas de negocio a nivel de base de datos: no exceder capacidad, no reducirla por debajo de la ocupación actual

## 4. Reproducción
- Monta (natural/inseminación artificial), parto, enlace con la cría
- Cálculo automático de fecha estimada de parto
- Aviso de consanguinidad al elegir padre

## 5. Salud
- Vacunas, tratamientos, desparasitación, con próxima dosis
- No permite usar insumos caducados ni fechas inválidas (futuras o anteriores al nacimiento)

## 6. Producción de leche
- Registro por turno (mañana/tarde/único), gráfica diaria
- Resumen por semana y mes, **comparación semana actual vs. anterior** con alerta de caída

## 7. Alimentación e insumos
- Catálogo de insumos con control de stock automático
- Alertas de stock bajo y de insumos caducados

## 8. Plan sanitario
- Plantillas de protocolo por edad (ej. "vacuna a los 90 días")
- Asignación a animales (individual o por lote)
- Cálculo automático de vencido / próximo / aplicado

## 9. Trabajo por lote
- Pesaje, salud y alimentación aplicados a varios animales de corrido
- **Venta por lote** (varios animales, un solo trato, precio total o por cabeza)

## 10. Trabajadores, usuarios y roles
- Alta/edición de trabajadores, con aviso al desactivar si tienen responsabilidades pendientes
- Login con **4 roles**: Administrador, Veterinario, Trabajador, Auditor — cada uno con permisos distintos
- Gestión de usuarios: cambiar rol, restablecer contraseña, activar/desactivar

## 11. Ventas y compras
- Venta individual y por lote, con historial y exportación a PDF/Excel
- Compra de insumos (aumenta stock) y de animales
- Catálogo de proveedores/compradores

## 12. Rentabilidad
- Por animal: costo real (compra + alimentación + salud) contra ingreso (venta + leche)
- Reporte general ordenado de más a menos rentable

## 13. Reportes
- KPIs: mortalidad, tasa de preñez, supervivencia de crías, ganancia diaria promedio
- Peso promedio por corral, ventas por mes
- Exportación a Excel

## 14. Tareas y calendario
- Asignación de tareas a trabajadores, con opción de marcarlas completadas
- **Calendario mensual** con vacunas, partos estimados, tareas y plan sanitario en un solo vistazo

## 15. Alertas y notificaciones
- Dashboard de inicio con resumen del día
- Badges de notificación en el menú
- **Alertas de hato/corral**: posibles brotes (varios animales enfermos en un mismo corral), corrales con pesajes atrasados, tendencia de mortalidad mensual

## 16. Auditoría y configuración
- **Bitácora operativa**: actor, rol, resultado y cambios antes/después; lectura para Administrador y Auditor
- **Panel de configuración**: umbrales ajustables (días de alerta, % de ocupación, precio de leche, etc.) sin tocar código

## 17. Listas imprimibles
- Lista de animales (con espacio para anotar peso a mano), tareas pendientes, vacunas próximas — todo en PDF

## 18. Diseño
- Identidad visual propia (colores, tipografía, iconos SVG)
- Menú lateral agrupado por secciones

---

## 19. Calidad técnica

- Suite automatizada con `node:test`, `supertest` y PostgreSQL real aislado
- Migraciones versionadas con baseline, checksum, transacciones, estado de solo lectura y advisory lock
- Validación reutilizable y rechazo de propiedades inesperadas en operaciones sensibles
- Errores HTTP estructurados sin exposición de información interna
- Transacciones y bloqueos de fila para ventas, compras, alimentación, bajas y cambios de categoría
- Matriz de permisos central con rol/estado activo recargado en cada request
- Auditoría esperada y transaccional para operaciones críticas y eventos de seguridad
- Base de pruebas aislada que se reconstruye de forma reproducible
- Build de producción del frontend y arranque normal del backend verificados
