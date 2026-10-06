# Iniciar El Rancho

## En esta PC o desde el celular

1. Haz doble clic en **EL RANCHO - INICIAR.bat**.
2. Elige:
   - **1** para usarlo solamente en esta PC.
   - **2** para una prueba rápida desde el celular en la misma red (Wi-Fi o Mobile Hotspot). Usa
     `http://IP:5173`: **no sirve para trabajar sin conexión** (ver abajo).
   - **3** para el **celular con la app instalada y offline** (HTTPS local). Es el modo de campo.
   - **4** para una **demo pública por Internet** (Cloudflare): cualquier celular, incluso con datos
     móviles u otra red, con una URL HTTPS temporal y un QR.
3. Espera el resumen `Backend / Frontend / PostgreSQL: LISTO`.
4. En la PC abre `http://localhost:5173`.
5. En el celular escanea el QR (también se abre como imagen y queda guardado en
   `%LOCALAPPDATA%\ElRancho\el-rancho-celular-qr.png`) o escribe la dirección de **Abre en tu celular**.

No necesitas `ipconfig` ni cambiar ninguna IP en archivos: la dirección se detecta cada vez que arrancas.
La PC y la ventana del launcher deben permanecer encendidas y abiertas.

Para cerrar, presiona **Enter**, **Q** o **Ctrl+C** en el launcher. También puedes hacer doble clic en
**EL RANCHO - CERRAR.bat**. Este cierre solo termina los procesos iniciados por El Rancho; no cierra
otros proyectos Node abiertos en la computadora.

## Cómo elige la dirección del celular

`scripts/el-rancho-red.psm1` lee las interfaces con la API .NET de Windows (sin privilegios) y
`frontend/scripts/lan-launcher.mjs` decide:

1. **Mobile Hotspot** (adaptador *Wi-Fi Direct Virtual Adapter*, normalmente `Conexión de área local*`
   con `192.168.137.1`): si está activo y responde, es la dirección del celular. `Modo: Celular por
   Mobile Hotspot`. También muestra cuántos dispositivos están conectados al hotspot.
2. **Wi-Fi o Ethernet con gateway**: `Modo: Red local Wi-Fi` (o Ethernet), por métrica de Windows.
3. **Red local privada sin gateway** (router sin Internet, cable directo): sigue siendo válida para
   probar el modo offline.

Se ignoran, con el motivo visible en la detección, las interfaces desconectadas, loopback, direcciones
automáticas `169.254.*`, direcciones no privadas, Hyper-V/WSL/Docker/VMware/VirtualBox, VPN y túneles
(Tailscale, ZeroTier, WireGuard…) y Bluetooth.

Cada candidata se verifica desde la propia laptop pidiendo `http://IP:5173` y comprobando que conteste
El Rancho. Si hay dos redes igual de plausibles (por ejemplo Wi-Fi y Ethernet), el launcher lo dice y
muestra ambas en lugar de elegir en silencio. Esa verificación local no prueba el Firewall; el
Firewall se revisa aparte.

**mDNS / `el-rancho.local`:** no se implementó. Publicar un nombre propio exige un servicio o
dependencia adicional y abrir UDP 5353, y Android y Windows lo resuelven de forma desigual. El QR con
la IP detectada es la vía principal.

## Firewall

El celular necesita TCP **5173** (opción 2) o TCP **5443** y **5180** (opción 3). El backend permanece
detrás del proxy `/api`; no es necesario abrir el puerto 3000 hacia la LAN.

El launcher lee las reglas con `netsh` (sin privilegios). Solo cuentan reglas que nombran el puerto
5173 o el programa `node.exe`, y una regla de **bloqueo** tiene prioridad. Si falta el permiso:

- **Red privada:** ofrece crear una sola regla `El Rancho Frontend LAN` (entrada, TCP 5173, perfil
  Privado, solo subred local).
- **Mobile Hotspot en perfil Público:** ofrece `El Rancho Frontend Mobile Hotspot` limitada al
  adaptador del hotspot y a su subred local.
- **Otra red pública:** no crea nada; indica cambiar la red a Privada si es de confianza.

La regla se crea solo si respondes **S** y Windows pide permiso de administrador. Si ya existe una
regla con ese nombre no se duplica. Nunca desactiva el Firewall. En modo no interactivo (`-NoWait` o
`-SkipFirewallPrompt`) solo informa.

## Puerto 5173 ocupado

Antes de iniciar, el launcher identifica el PID que ocupa 5173:

- Si su línea de comandos es el Vite de **esta** carpeta `frontend\node_modules` (una instancia vieja
  de El Rancho), lo cierra de forma segura y arranca uno nuevo.
- Si no se puede demostrar que es El Rancho, muestra PID, programa y comando, y **no lo cierra**.

Nunca usa `taskkill /IM node.exe`. Los escenarios se prueban con
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probar-puerto-launcher.ps1`, que usa
puertos de prueba y no toca una instancia en uso.

## App instalada y offline en el celular (opción 3)

Un navegador solo guarda la app para abrirla sin red (Service Worker) en un origen **seguro**
(HTTPS). `http://IP:5173` no lo es: ahí no hay Service Worker, así que cerrar y volver a abrir El
Rancho sin conexión no puede funcionar. La opción 3:

1. compila la app de producción (`npm run build`, que genera el Service Worker);
2. crea, la primera vez, un **certificado raíz propio de esta laptop** y un certificado para sus IP.
   El certificado raíz solo puede avalar direcciones de redes privadas y `localhost`: no sirve
   para suplantar sitios de Internet. Se guardan en `%LOCALAPPDATA%\ElRancho\https` (no se tocan los
   certificados de Windows);
3. sirve la app en **`https://IP:5443`** y el certificado público en **`http://IP:5180`**.

Con **Mobile Hotspot** la laptop siempre es `192.168.137.1`, así que la app instalada queda en
`https://192.168.137.1:5443` para siempre. Si usas otro Wi-Fi, la IP (y por tanto la app) cambia:
para campo usa el hotspot. Si la laptop cambia de red, reinicia el launcher para renovar el
certificado del servidor (el certificado raíz de los celulares no cambia).

### Preparar cada celular (una sola vez)

1. Conecta el celular al hotspot de la laptop e inicia el launcher con la opción **3**.
2. Escanea el segundo QR (`http://192.168.137.1:5180`), descarga el certificado e instálalo en
   Android como **Certificado de CA** (Ajustes → Seguridad → Encriptación y credenciales →
   Instalar un certificado). Android avisará que "la red podría estar supervisada": es normal.
3. Escanea el primer QR (`https://192.168.137.1:5443`), inicia sesión y ve a
   **Configuración → Sincronización**: debe decir *Trabajo sin conexión: disponible hasta…* y
   *Abrir sin conexión: lista*.
4. En Chrome, menú → **Instalar app** (o *Agregar a la pantalla principal*).

### Sesión sin conexión

- Iniciar sesión siempre requiere al servidor; sin sesión previa se pide conexión.
- Con una sesión previa, perder la conexión **no** cierra la sesión: la app entra en
  *Trabajando offline* con el último snapshot, hasta **72 horas** desde la última validación con el
  servidor, aunque el JWT venza.
- Sincronizar siempre exige que el servidor acepte la sesión. Si venció, se desactivó el usuario
  o cambió su rol, se pide iniciar sesión otra vez y las capturas pendientes se conservan.
- **Cerrar sesión** borra la sesión local y el snapshot, pero conserva las capturas pendientes de
  esa cuenta (separadas por usuario, no cifradas) hasta que la misma cuenta vuelva a entrar.

## Demo pública por Internet (opción 4)

Para mostrar El Rancho a alguien que no está en tu red. No requiere cuenta de Cloudflare, dominio ni
abrir puertos del router o del Firewall: `tools\cloudflared.exe` crea un **Quick Tunnel** de salida.

```
Celular (datos móviles) → https://xxxx.trycloudflare.com → vite preview (127.0.0.1:4173, build de producción)
                                                              └─ /api y /uploads → backend (127.0.0.1:3000) → PostgreSQL local
```

1. Doble clic en **EL RANCHO - INICIAR.bat** y elige **4**.
2. El launcher:
   - comprueba PostgreSQL y que exista `tools\cloudflared.exe`;
   - inicia el backend en modo demo (solo `127.0.0.1`, sin trabajos programados ni correo) o reutiliza
     uno de El Rancho que ya esté sano;
   - compila el frontend de producción y lo sirve con `vite preview` y el proxy `/api` existente;
   - abre el túnel (`--http-host-header` para que Vite acepte las peticiones);
   - lee la URL `https://….trycloudflare.com` del registro del túnel;
   - **la prueba desde la propia PC** antes de anunciarla: aplicación (HTTPS 200), `/login`,
     `/api/health` y la API protegida (401 sin sesión). Reintenta hasta 90 s mientras Cloudflare
     propaga el subdominio;
   - muestra **DEMO LISTA**, la URL y el QR (también en `%LOCALAPPDATA%\ElRancho\el-rancho-demo-qr.png`;
     la URL en `el-rancho-demo-url.txt`).
3. Mantén abierta esa ventana. Para terminar: **Enter**, **Q** o **Ctrl+C**, o **EL RANCHO - CERRAR.bat**.
   No la cierres con la X: los procesos quedarían abiertos (CERRAR.bat los cierra después).

Seguridad: el celular solo ve la aplicación por una única URL HTTPS; las llamadas `/api` viajan por
el mismo origen (sin CORS abierto). PostgreSQL y el puerto 3000 no se publican. Solo se cierran
procesos de esta copia de El Rancho (PID y línea de comandos verificados), nunca `node.exe` ni
`cloudflared.exe` ajenos.

Mensajes posibles: *Cloudflared no esta instalado*, *Puerto ocupado por otro proceso*, *Backend no pudo
iniciar*, *No fue posible obtener URL publica de Cloudflare* (sin Internet o límite temporal de Cloudflare)
y *La URL publica existe pero /api/health no responde*. Los registros quedan en
`%LOCALAPPDATA%\ElRancho` (`cloudflared-error.log`, `backend-error.log`, `frontend-error.log`).

La URL cambia en cada arranque y requiere Internet: sirve para demostraciones, no como app instalada
de campo (para eso, la opción 3). El flujo anterior de certificación PWA sigue disponible con
`scripts\iniciar-el-rancho.ps1 -Mode Https` (**EL RANCHO - PRUEBA PWA HTTPS.bat**).

## Si el celular no abre la dirección

- Confirma que el celular esté en el mismo Wi-Fi o conectado al hotspot de la laptop (no en una red
  de invitados, que suele aislar dispositivos).
- Si aparecen alternativas, abre la de la red a la que está conectado el celular.
- Revisa la línea `Firewall:` del resumen; si dice `FALTA REGLA`, vuelve a iniciar y acepta crearla.
- Si una política administrada bloquea el puerto, solicita a un administrador la misma regla
  descrita arriba.

## Mensajes frecuentes

- **PostgreSQL no respondió:** inicia el servicio PostgreSQL y vuelve a intentar.
- **Puerto 3000 ocupado:** si no es una instancia saludable de El Rancho, cierra la aplicación que lo
  usa. El launcher muestra su PID y nunca lo mata automáticamente.
- **Puerto 5173 ocupado por otro proceso:** ver la sección anterior.
- **Frontend o backend no quedó listo:** revisa los archivos indicados dentro de
  `%LOCALAPPDATA%\ElRancho`. Los logs no muestran secretos deliberadamente, pero no deben publicarse.

Para pruebas del propio launcher, `EL_RANCHO_PUERTO_FRONTEND` cambia el puerto del frontend y
`EL_RANCHO_RUNTIME_DIR` el directorio de estado.
