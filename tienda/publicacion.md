# Publicar Ranking LAN en la Microsoft Store

Guía paso a paso. Los textos del listado están en `listado-microsoft-store.md` y las capturas en
`capturas/`. La app se publica como PWA alojada: el paquete MSIX solo apunta a la URL de
producción, así que cada despliegue web actualiza la app de la Store sin volver a enviar paquete.

## 1. Requisitos previos

- Cuenta de desarrollador en [Partner Center](https://partner.microsoft.com/dashboard) (pago
  único; la verificación de identidad puede tardar días).
- La app desplegada en https://d3b4s9lb316i67.cloudfront.net/ con el service worker **v9**
  (`const VERSION = 'v9'` en `sw.js`) y https://d3b4s9lb316i67.cloudfront.net/privacidad.html
  respondiendo 200. Comprobar:

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://d3b4s9lb316i67.cloudfront.net/privacidad.html
  curl -s https://d3b4s9lb316i67.cloudfront.net/sw.js | grep "VERSION ="
  ```

- Un equipo con Windows 11 y Microsoft Edge para las pruebas del apartado 4.

## 2. Reservar el nombre en Partner Center

1. Partner Center → **Apps y juegos** → **Nuevo producto** → **MSIX o PWA**.
2. Reservar el nombre **Ranking LAN**.
3. En **Administración de productos → Identidad del producto** copiar tres valores (se pegan en
   PWABuilder en el paso siguiente):
   - **Package ID** (`Package/Identity/Name`), p. ej. `12345ErickrU.RankingLAN`.
   - **Publisher ID** (`Package/Identity/Publisher`), con la forma `CN=xxxxxxxx-xxxx-...`.
   - **Publisher display name** (nombre del editor tal y como aparece en la Store).

## 3. Generar el paquete con PWABuilder

1. Abrir https://www.pwabuilder.com y pegar `https://d3b4s9lb316i67.cloudfront.net/`.
2. Revisar el informe: manifest y service worker deben estar en verde (iconos, `screenshots`,
   `shortcuts`, `display_override` con `window-controls-overlay`, `launch_handler`,
   `categories`, `description`, `widgets`). Si algo aparece en amarillo, decidir si se corrige
   en `manifest.webmanifest` antes de empaquetar (y subir `VERSION` del SW, porque el manifest
   está precacheado).
3. **Package for stores → Windows**. Rellenar:
   - URL: `https://d3b4s9lb316i67.cloudfront.net/`
   - Package ID, Publisher ID y Publisher display name: los copiados de Partner Center.
   - App name: `Ranking LAN`.
   - Version: `1.0.0.0` (la Store exige la última cifra en 0).
   - Dejar activadas las opciones por defecto (incluye el modo de aplicación de Edge).
4. Descargar el zip. Contiene el `.msixbundle` (para la Store) y un paquete de prueba `.msix`
   para instalar localmente (*sideload*), además de un `readme` con las instrucciones de firma de
   prueba.

## 4. Pruebas en Windows 11 con el paquete de prueba

Instalar el `.msix` de prueba con doble clic (o en PowerShell `Add-AppxPackage .\...msix`;
si Windows rechaza la firma, seguir el readme del zip para instalar el certificado de prueba).
Abrir la app desde el menú Inicio y repasar:

**Barra de título (Window Controls Overlay)**

- Al abrir, la cabecera de Ranking LAN ocupa la franja de título de la ventana y termina **antes**
  de los botones minimizar/maximizar/cerrar; ningún control de la app queda debajo de ellos.
- Redimensionar la ventana por debajo de ~900 px: la cabecera baja a su propia fila
  (`body.wco-angosto`) y los botones nativos siguen accesibles.
- Alternar la superposición desde el menú de la ventana (botón `^` de la barra de título): la
  cabecera vuelve a ser una barra normal y al reactivarla vuelve a la franja.
- En DevTools (F12) → Consola:
  `getComputedStyle(document.querySelector('.cabecera')).width` debe coincidir con
  `navigator.windowControlsOverlay.getTitlebarAreaRect().width + 'px'`.

**Notificaciones**

- Abrir la sección **Avisos y distintivos** (al final de la página) → **Activar avisos** →
  aceptar el permiso en el diálogo de Windows. El estado debe indicar «Avisos activados» y si la
  sincronización en segundo plano quedó registrada (requiere la app instalada y uso reciente).
- **Probar aviso**: aparece una notificación en el Centro de actividades con el título «Aviso de
  prueba · Ranking LAN» y los botones **Ver mi grupo** y **Ver ranking**. Cada botón abre o
  enfoca la app en la pestaña correspondiente (Mi grupo / Ranking regional).
- Con la app abierta, cambiar de región y pulsar **Comprobar ahora**: la primera vez solo guarda
  la instantánea; no debe aparecer ningún aviso falso.
- Para forzar la sincronización periódica sin esperar 12 h: DevTools → **Application → Service
  workers** → campo **Periodic Sync** → escribir `avisos` y pulsar el botón. En la consola del SW
  se ve la petición a `/api/ranking` y `/api/jugador`. Con la app cerrada, Edge la ejecuta según
  el *site engagement* del sistema.

**Distintivo**

- Tras **Probar aviso**, el icono de Ranking LAN en la barra de tareas muestra un número.
- Al volver a enfocar la ventana (o abrir la sección Avisos) el número desaparece.

**Widgets**

- Win + W → **Agregar widgets** → **Ranking LAN** → **Top 3 LAN**. La tarjeta muestra el podio
  de la región configurada; **Actualizar** la repinta y **Abrir ranking** abre la app.

**Sin conexión**

- Activar el modo avión y volver a abrir la app: carga con los datos en caché y el chip de
  estado pasa a «Sin conexión». Mi grupo y el panel de widgets siguen abriendo.

**Legal y privacidad**

- El pie y la ayuda (botón **Ayuda**) muestran el aviso de Riot Games en inglés y su
  traducción, y el enlace **Política de privacidad** abre `/privacidad.html`.

Si alguna prueba falla, corregir en el repositorio, redesplegar (paso 7 del README) y repetir:
el paquete no cambia porque solo contiene la URL.

## 5. Enviar a certificación

1. Partner Center → Ranking LAN → **Envío** → **Paquetes**: subir el `.msixbundle`. Mercado:
   todos (o los de LATAM primero). Precio: gratis.
2. **Propiedades**: categoría **Entretenimiento**; en **Declaraciones de la app** nada marcado.
3. **Clasificación por edades**: completar el cuestionario IARC con las respuestas sugeridas en
   `listado-microsoft-store.md`.
4. **Listados de la Store → Español (y opcionalmente inglés)**: pegar nombre, descripción corta y
   completa, características, términos de búsqueda, novedades, copyright y URLs de
   `listado-microsoft-store.md`. Subir las capturas `capturas/*.png` (escritorio, 1920 × 1080)
   con sus leyendas.
5. **Capacidades**: al detectar `runFullTrust` Partner Center pedirá justificación; pegar el
   texto de `listado-microsoft-store.md`.
6. **Notas para la certificación**: indicar que la app funciona sin cuenta, que los datos son de
   demostración mientras Riot no apruebe la clave de producción (chip «Datos demo» visible) y
   cómo probar avisos y widget (apartado 4).
7. **Enviar a la Store**. La certificación suele tardar de uno a tres días hábiles.

## 6. Después de la certificación

1. En Partner Center → **Clasificación por edades** copiar el **IARC rating ID** y añadirlo al
   manifest:

   ```json
   "iarc_rating_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
   ```

2. Subir `VERSION` en `sw.js` (`v9` → `v10`): el manifest está precacheado y sin nueva versión los
   clientes no lo refrescarían.
3. Redesplegar: `bash despliegue/desplegar.sh` (ver README → Desplegar).

## 7. Cuando Riot apruebe la Production API Key

1. Desplegar con la clave:

   ```bash
   bash despliegue/desplegar.sh --clave RGAPI-xxxxxxxx-...
   ```

   o, sin reconstruir la imagen, actualizar el secreto y reiniciar el servicio como describe el
   README (`aws secretsmanager put-secret-value` + `aws ecs update-service --force-new-deployment`).
2. El chip **Datos demo** desaparece solo (el proxy informa `claveConfigurada: true` en
   `/api/estado`) y el listado pasa a **Datos en vivo**.
3. Revisar `TOP_JUGADORES` y `TTL_SEGUNDOS` (README → Variables de entorno) según la cuota de la
   clave de producción.
4. Si cambia el alcance (más jugadores, más regiones), actualizar la descripción del listado y
   las capturas (`node herramientas/capturas-tienda.mjs` con el proxy apuntando a datos reales) y
   enviar una actualización solo del listado: no hace falta nuevo paquete.

## 8. Reversión

El despliegue anterior a esta entrega es la task definition `ranking-lan:16`. Para volver a ella:

```bash
aws ecs update-service --cluster ranking-lan --service ranking-lan \
  --task-definition ranking-lan:16 --force-new-deployment
aws ecs wait services-stable --cluster ranking-lan --services ranking-lan
```

La app de la Store seguirá funcionando porque solo apunta a la URL.

## 9. Fuera de alcance

- Dominio propio y certificado ACM (la cuenta no permite emitirlo hoy). La URL pública sigue
  siendo la de CloudFront; si en el futuro se añade dominio, hay que volver a empaquetar con
  PWABuilder porque la URL va dentro del MSIX, y actualizar `id` y `start_url` del manifest.
- Notificaciones push (Push API): la app no las usa; los avisos se generan en el dispositivo.
