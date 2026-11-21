# Plan de respuesta ante un rechazo de la Microsoft Store · Ranking LAN

Qué hacer si la certificación falla: causas probables para esta app con qué comprobar, qué
cambiar y qué responder al certificador; cómo leer el informe, corregir, reenviar y apelar en
Partner Center; y una lista de verificación de minutos antes de reenviar.

Fuentes oficiales (los números de política son los de ahí; aquí se resumen en español y el texto
en inglés es el que manda):

- [Microsoft Store Policies, versión 7.20](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)
  (publicada el 15 de septiembre de 2026, vigente desde el 22 de octubre de 2026). Las políticas
  de producto son la serie **10.x** y las de contenido la **11.x**.
- [The app certification process for PWA](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/pwa/app-certification-process)
  (fases, informe de certificación, plazos).
- [Fix Microsoft Store submission and certification failures](https://learn.microsoft.com/en-us/windows/apps/publish/fix-submission-failures)
  (síntoma → causa → arreglo; nombra la política **10.5.1** como fallo típico de privacidad).

Contexto de esta app: PWA alojada en https://d3b4s9lb316i67.cloudfront.net/, empaquetada con
PWABuilder (MSIX con `runFullTrust`), sin cuentas, sin compras, sin publicidad, categoría
Entretenimiento, cuenta de desarrollador individual. El paquete solo contiene la URL: casi todo
se corrige redesplegando la web (`bash despliegue/desplegar.sh`), sin tocar el paquete.

---

## 1. Causas de rechazo más probables

Ordenadas de más a menos probable para Ranking LAN. Las tres primeras son las que hay que mirar
antes que nada.

### 1.1 El certificador no pudo verificar la funcionalidad (servidor, primera visita, service worker)

**Políticas:** **10.3** (el producto debe poder probarse) y **10.3.2** (si depende de un servidor,
el servidor debe estar operativo); **10.1.2** (debe estar completamente funcional); **10.4.2**
(arranca con rapidez, sigue respondiendo y no se cierra de forma inesperada). En el informe suele
aparecer como «no se pudo verificar la funcionalidad descrita», «la app no carga contenido» o
«crash/hang».

**Por qué es la más probable aquí:** el certificador instala el MSIX, Edge abre la URL por primera
vez con un perfil limpio y, si el service worker no se instala en esa primera carga, no funcionan
ni el widget, ni «Probar aviso», ni el modo sin conexión que describen las notas de certificación.
Ese fallo existía (SW v10: la versión quedaba `redundant` cuando el navegador detenía el worker
durante el `install`) y está corregido en SW v11: shell crítico atómico en `install`, resto del
shell tolerante en `activate`, y `js/registro-sw.js` vuelve a registrar el SW si la instalación se
interrumpe (hasta 4 reintentos).

**Qué comprobar** (sección 3, puntos 1 a 4): producción responde 200 en `/`, `/api/estado`,
`/sw.js` (con `VERSION = 'v11'`) y todas las rutas del precache; `node herramientas/sw-primera-visita.mjs`
da **10/10** contra producción; el verificador local está al 100 %; la tarea de ECS está estable
y no hay datos de demostración si las notas dicen «datos en vivo» (`/api/estado` →
`claveConfigurada: true`).

**Qué cambiar:** si algo de lo anterior falla, corregir y redesplegar; si CloudFront sigue
sirviendo el `sw.js` viejo, invalidar (`aws cloudfront create-invalidation --distribution-id
E2XGV0UL856TYK --paths "/*"`). Si el proxy estaba sin clave de Riot (chip «Datos demo»), o se
despliega con la clave o se dice en las notas que los datos son de demostración, nunca lo
contrario de lo que el certificador ve.

**Qué responder:** en **Notas para la certificación** (y en la apelación si procede) pegar los
pasos exactos: abrir la app, esperar el ladder (sin cuenta ni inicio de sesión: 10.3.1 no
aplica), «Avisos y distintivos → Activar avisos → Probar aviso», Win + W → agregar «Top 3 LAN»,
modo avión → reabrir. Indicar que el servidor es público, no requiere credenciales y que la
funcionalidad es la de la descripción.

### 1.2 Política de privacidad (URL ausente, no accesible o incompleta)

**Políticas:** **10.5.1**: si el producto accede, recoge o transmite información personal (y la
dirección IP que recibe el servidor cuenta) debe haber una política de privacidad, su URL se
introduce en Partner Center y debe explicar qué datos se tratan, para qué, cómo se guardan y
protegen, con quién se comparten y qué control tiene el usuario; además los productos **Desktop
Bridge y Win32 siempre** necesitan una, y en la práctica Partner Center trata un MSIX con
`runFullTrust` como paquete de plena confianza, así que la pide siempre. También
**10.5.4** (los datos personales viajan con criptografía moderna: todo va por HTTPS) y **10.5.8**
(leyes de privacidad sobre menores: no se recogen datos de nadie). La guía de fallos de Microsoft
cita literalmente «Privacy policy failure (policy 10.5.1)» como causa frecuente.

**Qué comprobar:** en Partner Center → envío → **Propiedades** → *Privacy policy URL* =
`https://d3b4s9lb316i67.cloudfront.net/privacidad.html` (sin espacios, con `https`); que la página
responde 200 desde fuera (`curl`), que la fecha de «Última actualización» es anterior o igual al
envío y que su contenido sigue siendo verdad: qué se guarda en el dispositivo (localStorage y
Cache Storage), qué recibe el servidor (IP, cabeceras, parámetros de consulta), retención
(RAM 10 min / 24 h, CloudWatch 7 días sin IP), terceros (Riot API desde el servidor, Data Dragon
desde el navegador, AWS), que no hay analítica ni rastreadores, el permiso de notificaciones y el
enlace «Compartir grupo». La misma URL está en el listado (`listado-microsoft-store.md` → URLs),
en el pie de la app y en la ayuda.

**Qué cambiar:** si falta la URL, añadirla en Propiedades y reenviar (solo listado, sin paquete).
Si el certificador pide un dato concreto (p. ej. el tratamiento de la IP o la retención),
editar `privacidad.html`, actualizar la fecha, redesplegar y comprobar el 200 antes de reenviar.

**Qué responder:** la URL exacta, que la política es pública y enlazada desde la app, y que la
app no tiene cuentas, no recoge datos de contacto y no comparte datos con terceros más allá de la
infraestructura descrita.

### 1.3 Metadatos y capturas que no coinciden con la app (nombre, descripción, términos, idiomas)

**Políticas:** **10.1** y **10.1.1** (título, descripción, capturas, clasificación, términos de
búsqueda y categoría deben reflejar con exactitud lo que hace la app; el nombre debe ser único y
sin texto publicitario; no insinuar relación con otros productos ni con una empresa sin permiso;
las apps web deben publicarlas el dueño del dominio); **10.1.3** (términos de búsqueda: máximo
siete, relevantes, sin precios y **sin títulos de otros productos** salvo que sean tuyos);
**10.1.4** (metadatos distintos e informativos); **10.7** (si declaras un idioma, descripción y
experiencia en ese idioma); **11.1** (los metadatos no pueden superar PEGI 12 / ESRB E10+).

**Riesgos concretos de este listado:**

- Los términos de búsqueda sugeridos incluyen «League of Legends» y «LoL», que son el título de
  un producto de Riot Games: un certificador estricto puede objetarlos bajo **10.1.3**.
- Las capturas deben mostrar la app tal como está en producción. `05-avisos.png` se regenera tras
  cada cambio del SW porque los textos de los avisos salen del SW (`node herramientas/capturas-tienda.mjs`,
  1920 × 1080, sin chip «Datos demo»).
- El nombre del paquete («Ranking LAN») y el `short_name` del manifest coinciden; el `name` largo
  del manifest («Ranking LAN · Ladder de Latinoamérica Norte») es solo descriptivo.
- Si se publica listado en inglés, la descripción debe estar en inglés y la app ya ofrece la
  interfaz en inglés (selector ES/EN).

**Qué comprobar:** descripción y características frente a la app real (regiones, colas, ligas,
Mi grupo hasta 20, widget, avisos, sin conexión, ES/EN); las cinco capturas abren y miden
1920 × 1080 (`sips -g pixelWidth -g pixelHeight tienda/capturas/*.png`); leyendas acordes;
categoría **Entretenimiento** (no «Juegos»: no hay juego, solo estadísticas públicas).

**Qué cambiar:** si objetan **10.1.3**, sustituir «League of Legends» y «LoL» por términos
genéricos («ranking», «ladder», «clasificatoria», «LAN», «Riot ID», «estadísticas», «élite»).
Si objetan una captura, regenerarla contra producción y volver a subirla. Si piden
categorizarla como juego, explicar que no ofrece jugabilidad ni acceso a juegos (ver 1.4).
Todo esto es solo listado: no hace falta nuevo paquete.

**Qué responder:** la lista punto por punto de dónde se ve en la app cada frase de la descripción
y cada captura (pestaña, control o sección), y que la app la publica el dueño del dominio
(la distribución de CloudFront está en la cuenta de AWS del publicador).

### 1.4 Capacidad restringida `runFullTrust` y seguridad del paquete

**Políticas:** **10.6** (las capacidades declaradas deben corresponder de verdad a las funciones
del producto); **10.2** (no comprometer la seguridad del dispositivo); **10.2.2** (no cambiar ni
ampliar la funcionalidad descrita mediante inclusión dinámica de código); **10.2.3** (sin
malware ni instalación de software secundario); **10.2.7** (desinstalación limpia).

**Qué comprobar:** la justificación de `runFullTrust` está pegada en **Submission options →
Restricted capabilities** (texto en `listado-microsoft-store.md` → «Capacidades y justificación»);
el paquete no declara ninguna otra capacidad; el MSIX solo apunta a la URL de producción y el
código que carga es siempre el del mismo origen (sin scripts de terceros, sin `eval`, sin
`innerHTML` con datos). Desinstalar desde Configuración → Aplicaciones no deja nada: los datos
viven en el almacenamiento del perfil de Edge de la app.

**Qué cambiar:** nada en el código. Si el certificador pide más detalle, ampliar la justificación
con la lista de API web que usa (Notifications, Badging, Periodic Background Sync, PWA Widgets,
Window Controls Overlay) y que ninguna requiere `runFullTrust`.

**Qué responder:** la capacidad la exige el paquete que genera PWABuilder para PWA alojadas (Edge
en modo aplicación); la app no accede al sistema de archivos, no ejecuta código nativo, no
instala servicios ni modifica el sistema; sobre **10.2.2**, el código web se sirve desde el origen
declarado y hace exactamente lo descrito en el listado, como cualquier PWA alojada.

### 1.5 Contenido de terceros: marcas, nombres y retratos de Riot Games

**Políticas:** **11.2** (todo el contenido y los metadatos deben ser propios, con licencia del
titular, usados como él permite o permitidos por ley; los titulares pueden denunciar
infracciones); **10.1.1** (no aparentar relación con otro producto o empresa).

**Qué comprobar:** el aviso legal exigido por Riot («Ranking LAN isn't endorsed by Riot Games…»)
y su traducción están en la descripción del listado, en el pie de la app, en la ayuda y en
`privacidad.html`; `/riot.txt` responde 200 (verificación del portal de desarrolladores de Riot,
la clave de la API se usa bajo sus políticas); los iconos y logos de la Store (`iconos/`,
`tienda/logos/`) no usan logos ni marcas de Riot; los retratos de campeones vienen de Data Dragon,
el CDN público de Riot para estos usos; el campo «Copyright y marcas» del listado atribuye las
marcas a Riot Games, Inc.

**Qué cambiar:** si el certificador objeta los retratos o nombres de campeones en las capturas,
sustituir las capturas 02 y 03 por otras sin esas imágenes (p. ej. tabla del ranking y Mi grupo
sin abrir el detalle) y reenviar solo el listado. Si objeta el uso de la palabra «League of
Legends» en descripción o términos, dejarla únicamente en el aviso legal y en «Copyright y
marcas» (ver 1.3).

**Qué responder:** que el uso es nominativo (describir de qué juego son las estadísticas), que
los datos vienen de la API oficial de Riot con una clave registrada en su portal de
desarrolladores, que se cumple su exigencia de aviso legal y que no se usan logos ni se insinúa
respaldo.

### 1.6 Acceso a internet: comportamiento sin red y con el servidor caído

**Políticas:** **10.4.2** (seguir respondiendo, no cerrarse de forma inesperada). La guía de
fallos de Microsoft lista explícitamente «la app se cierra o deja de responder sin conexión» y
pide un mensaje claro aunque la app necesite red.

**Qué comprobar:** con el SW activo, modo avión y reabrir: el ladder carga desde caché, el chip
pasa a «Sin conexión», Mi grupo y el panel de widgets abren; con red pero sin servidor aparece
«Sin conexión con el servidor» y la tabla conserva la copia guardada (el verificador local cubre
ambos casos: secciones «Offline» y «Servidor caído»). En una primera visita sin red la app muestra
`offline.html` o el estado vacío, nunca una página en blanco del navegador.

**Qué cambiar:** si falla, es un problema del service worker (precache o estrategia) o del
servidor: corregir, subir `VERSION` del SW, redesplegar.

**Qué responder:** describir la estrategia (network-first con respaldo de caché, shell precacheado,
mensaje explícito de servidor no disponible) y cómo reproducirla.

### 1.7 Clasificación por edades

**Políticas:** **11.11.1** (hay que obtener la clasificación respondiendo con exactitud el
cuestionario IARC en Partner Center); **11.11.2** (mantenerla actualizada si cambia la app);
**11.11.3** (si hubiera contenido que merezca una clasificación mayor, filtro u opt-in); **11.1**
(metadatos como máximo PEGI 12 / ESRB E10+).

**Qué comprobar:** las respuestas del cuestionario coinciden con la tabla de
`listado-microsoft-store.md` (sin violencia, sin compras, sin publicidad, sin ubicación, sin
comunicación entre usuarios, con acceso a internet solo a la API propia y a Data Dragon; muestra
nombres públicos del ladder). Resultado esperado: apto para todos los públicos.

**Qué cambiar:** si el informe dice que la clasificación no corresponde, repetir el cuestionario
con la respuesta que indiquen (lo habitual sería «acceso a internet: sí» o «muestra información
de otros usuarios: Riot ID públicos»). Tras la certificación, copiar el `iarc_rating_id` al
manifest, subir `VERSION` y redesplegar (`publicacion.md` §6).

**Qué responder:** que la app solo muestra tablas, nombres públicos y retratos oficiales de
campeones, sin escenas de juego, sin compras, sin anuncios ni comunicación entre usuarios.

### 1.8 Notificaciones

**Políticas:** **10.9** (respetar la configuración de notificaciones del sistema y seguir
funcionando cuando están desactivadas). Los avisos de Ranking LAN no usan WNS ni web push (se
generan en el dispositivo), así que **10.9.1**–**10.9.4** solo aplican por analogía: no disfrazar
el origen, no incluir información sensible, y que el contenido se refiera al producto.

**Qué comprobar:** con el permiso denegado o las notificaciones del sistema apagadas la app sigue
funcionando y la sección muestra «permiso denegado» sin pedirlo otra vez; el permiso solo se
solicita al pulsar «Activar avisos»; los avisos llevan el nombre «Ranking LAN» y solo hablan de
rangos y del top 3.

**Qué responder:** que no hay servidor push, que el permiso es opcional y se pide solo con un
gesto del usuario, y que las notificaciones se limitan a los cambios de rango del grupo y del
top 3 que el usuario eligió seguir.

### 1.9 Otras que no deberían aplicar (y qué decir si las citan)

- **10.8** (transacciones) y **10.8.3**/**10.14** (cuenta de empresa): la app no tiene compras,
  suscripciones ni pide datos financieros; cuenta individual válida.
- **10.13** (juegos y Xbox): no es un juego ni se publica para Xbox; no usa servicios de Xbox.
- **10.2.9**/**10.4.4** (instaladores por URL `.exe`/`.msi`): no aplica, es MSIX.
- **11.12** (contenido generado por usuarios): la lista «Mi grupo» es local y el enlace de
  compartir solo contiene Riot ID; nada se publica a otros usuarios.
- **10.1** (segundo punto: los productos de juego deben ir en «Juegos»): Ranking LAN no ofrece
  jugar, controlar un juego a distancia ni acceso a un catálogo de juegos; es una app de
  estadísticas públicas y va en Entretenimiento.

---

## 2. Procedimiento en Partner Center

### 2.1 Leer el informe de certificación

1. Llega un correo «certification failed» y en Partner Center → **Apps and games → Ranking LAN**
   el envío pasa a estado de certificación fallida con un enlace al **informe de certificación**.
2. El informe dice qué prueba falló (seguridad, cumplimiento técnico con el Windows App
   Certification Kit, o cumplimiento de contenido) y, en los fallos de contenido, **el número de
   política** (10.x o 11.x) con una nota del certificador y a veces capturas de lo que vio.
3. Buscar ese número en la sección 1 de este documento y en la página oficial de políticas; si
   es una prueba técnica, en la [guía de fallos](https://learn.microsoft.com/en-us/windows/apps/publish/fix-submission-failures).
4. Anotar la fecha y hora del informe: sirve para cruzarla con los registros de CloudWatch
   (`/ecs/ranking-lan`, retención 7 días) y ver si el servidor tuvo errores en ese momento.

### 2.2 Corregir

- **Solo listado** (descripción, términos, capturas, URL de privacidad, clasificación, notas): se
  edita en el envío y se reenvía; no hace falta nuevo paquete.
- **Comportamiento de la app**: se corrige en el repositorio, se ejecuta el verificador, se
  despliega (`bash despliegue/desplegar.sh`, `aws ecs wait services-stable`) y se comprueba
  producción con la lista de la sección 3. El paquete no cambia porque solo contiene la URL.
- **Paquete** (solo si cambian identidad, nombre, URL o PWABuilder pide regenerarlo): nuevo
  MSIX con la versión aumentada (`1.0.0.0` → `1.0.1.0`; la última cifra siempre 0) y subirlo en
  **Packages**; un paquete con el mismo nombre completo que uno ya enviado se rechaza en la
  validación de la carga.
- Actualizar **Notas para la certificación** con lo corregido y cómo verificarlo (texto en 3.3).

### 2.3 Reenviar

1. Abrir el envío fallido (sigue editable) o, si Partner Center lo pide, crear un envío nuevo.
2. Repasar **Propiedades** (categoría Entretenimiento, URL de privacidad, sitio web, soporte),
   **Clasificación por edades**, **Submission options** (justificación de `runFullTrust`, notas
   para la certificación) y **Store listings** (capturas 1920 × 1080 en PNG, leyendas).
3. **Submit to the Store**. La certificación puede tardar hasta tres días hábiles; tras aprobarse,
   el listado aparece en la Store en unos 15 minutos.

### 2.4 Apelar si el rechazo es erróneo

La página de políticas incluye el **Certification Appeal Process**: revisar la política citada y,
para preguntar por la revisión o el estado de certificación, escribir a **reportapp@microsoft.com**.
Para el periodo 7/2025–6/2026 Microsoft publica en esa misma página un tiempo medio de
tramitación de 2,37 días y 623 decisiones revocadas. Además, Partner Center → **Help + support**
permite abrir una solicitud de soporte sobre el envío.

Contenido del correo o la solicitud (en inglés, breve y con pruebas):

1. Nombre del producto («Ranking LAN»), Store ID y número de envío, fecha del informe.
2. Política citada y la frase exacta del informe.
3. Por qué no aplica o ya está corregido, con evidencia verificable: URL de producción, URL de la
   política de privacidad, pasos de reproducción, captura o vídeo corto, salida de
   `sw-primera-visita.mjs` (10/10) si el fallo fue de funcionalidad.
4. Qué se cambió desde el envío rechazado (si se cambió algo) y petición concreta: nueva revisión.

Mientras la apelación se tramita, se puede corregir y reenviar en paralelo si hay un arreglo
razonable: suele ser más rápido que esperar la respuesta.

---

## 3. Lista de verificación rápida antes de reenviar (≈ 10 minutos)

Desde la raíz del repositorio, con `main` limpio y el último despliegue estable.

### 3.1 Producción (1–2 min)

```bash
BASE=https://d3b4s9lb316i67.cloudfront.net

# Rutas clave y versión del service worker (debe ser la de sw.js en main)
for r in / /privacidad.html /riot.txt /manifest.webmanifest /sw.js /api/estado; do
  printf '%-24s %s\n' "$r" "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Cache-Control: no-cache' "$BASE$r")"
done
curl -sS -H 'Cache-Control: no-cache' "$BASE/sw.js" | grep -o "VERSION = '[^']*'"
grep -o "VERSION = '[^']*'" sw.js

# Datos en vivo (claveConfigurada: true) o demo: debe coincidir con lo que dicen las notas
curl -sS "$BASE/api/estado" | grep -o '"claveConfigurada":[a-z]*'

# Todas las rutas del precache (críticas y opcionales) en 200
node -e "
const s = require('fs').readFileSync('sw.js', 'utf8');
for (const n of ['PRECACHE_CRITICO', 'PRECACHE_OPCIONAL']) {
  const bloque = s.split('const ' + n + ' = [')[1].split('];')[0];
  for (const m of bloque.matchAll(/'\.\/([^']*)'/g)) console.log(m[1]);
}" | while read -r r; do
  printf '%-40s %s\n' "/$r" "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Cache-Control: no-cache' "$BASE/$r")"
done

# Despliegue estable y revisión de la definición de tarea
aws ecs describe-services --cluster ranking-lan --services ranking-lan \
  --query 'services[0].{estado:status,tarea:taskDefinition,deseadas:desiredCount,corriendo:runningCount}'
```

Todo debe dar `200`, la versión del SW de producción debe ser la de `main` y
`runningCount` = `desiredCount`. Si `/sw.js` sirve una versión vieja:
`aws cloudfront create-invalidation --distribution-id E2XGV0UL856TYK --paths "/*"` y repetir.

### 3.2 Instalación del service worker en la primera visita (2–3 min)

```bash
node herramientas/sw-primera-visita.mjs --url "$BASE/" --intentos 10
```

Resultado esperado: `10/10 intentos instalan y activan el service worker en la primera carga`
(tolera que la página reintente el registro). Un `FALLA` aquí reproduce exactamente lo que vería
el certificador en un perfil limpio: no reenviar hasta que sea 10/10.

### 3.3 Verificador local (≈ 5 min)

```bash
node servidor/proxy.mjs --puerto 8137 &
node herramientas/verificar.mjs --url http://localhost:8137/ --cdp 9333
```

Debe terminar al 100 % (hoy 127/127), incluidas las secciones «Instalación del service worker»
(recurso crítico ausente → la primera instalación falla entera y la página reintenta; recurso
opcional ausente → el SW se instala igual) y «Avisos y distintivos». Después, descartar los PNG
que regenera: `git checkout -- iconos/captura-*.png widgets/top3-lan-captura.png`.

### 3.4 Partner Center (2 min)

- **Propiedades**: categoría Entretenimiento; *Privacy policy URL*
  `https://d3b4s9lb316i67.cloudfront.net/privacidad.html`; sitio web y soporte
  (`https://github.com/ErickrU/ranking-lan/issues`).
- **Clasificación por edades**: cuestionario completado según `listado-microsoft-store.md`.
- **Submission options**: justificación de `runFullTrust` pegada; notas para la certificación
  actualizadas (abajo).
- **Store listings**: descripción y características de `listado-microsoft-store.md`; cinco
  capturas PNG 1920 × 1080 con leyenda (`sips -g pixelWidth -g pixelHeight tienda/capturas/*.png`);
  `05-avisos.png` regenerada después del último despliegue del SW.
- **Packages**: el `.msixbundle` vigente; solo subir uno nuevo si cambió la identidad o la URL
  (versión aumentada).

Notas para la certificación sugeridas (en inglés, que es lo que lee el certificador):

```
Ranking LAN is a hosted PWA (https://d3b4s9lb316i67.cloudfront.net/). No account or sign-in is
required; the backend is public. Data comes from the official Riot Games API through our own
server (live data; the "Live data" chip is shown at the top).

How to verify:
1. Launch the app: the regional ladder loads within a few seconds. Change region/queue/tier with
   the selectors at the top.
2. "Mi grupo" tab: add any Riot ID (e.g. the top player shown on the podium) to build a private
   group; click a row to open the detail with match history and tips.
3. "Avisos y distintivos" section (bottom of the page): "Activar avisos" asks for the notification
   permission (only on click); "Probar aviso" shows a test notification with two actions and a
   badge on the taskbar icon.
4. Widgets: Win + W → Add widgets → Ranking LAN → "Top 3 LAN".
5. Offline: enable airplane mode and reopen the app; it loads from cache and shows "Sin conexión".
The UI is available in Spanish and English (ES/EN selector in the title bar). Privacy policy:
https://d3b4s9lb316i67.cloudfront.net/privacidad.html. runFullTrust is required by the PWABuilder
package only; the app runs entirely as web code in Microsoft Edge.
```

### 3.5 A mano en Windows 11 (si hay un equipo a mano, 5 min)

Seguir `publicacion.md` §4 con el `.msix` de prueba **en un perfil nuevo de Edge** (o tras borrar
los datos del sitio): abrir la app por primera vez y comprobar que el pie dice «Service worker:
activo», que «Probar aviso» muestra la notificación y que el widget se agrega. Esa primera
apertura es la que hace el certificador.
