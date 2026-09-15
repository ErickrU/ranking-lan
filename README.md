# Ranking LAN · PWA

Aplicación web progresiva con el ranking de los mejores jugadores de **League of Legends**,
consultable en **15 regiones** (LAN, LAS, NA, BR, EUW, EUNE, TR, RU, ME, KR, JP, OCE, SG,
TW, VN) y en **todas las ligas**: de Hierro a Retador (bajo Maestro, con su selector de
división), en las colas Solo/Dúo y Flexible. La interfaz está en **español e inglés**,
conmutables al vuelo.

Es instalable, funciona sin conexión y no expone ninguna credencial en el navegador.
Además del ladder regional incluye **Mi grupo**: una clasificación privada entre amigos,
agregados por Riot ID (nombre y tag en campos separados) y ordenados por su rango real
(liga → división → LP). El detalle de cada integrante suma su **mini historial de
partidas** (match-v5), la **comparación contra el promedio del grupo** y **consejos**
generados a partir de esos números.

---

## Arrancar en 30 segundos

No hay dependencias que instalar: solo Node 20.12 o superior.

```bash
cd ranking-lan
node servidor/proxy.mjs
# abre http://localhost:8080/
```

El service worker exige un origen seguro, así que **`http://localhost` sí funciona pero
`file://` no**. Abrir `index.html` con doble clic deja la app sin modo offline ni instalación.

## Datos reales vs. modo demostración

Al arrancar sin clave verás un aviso de **modo demostración**: los Riot ID son ficticios y
no representan el ladder real. Es intencional: así la app es usable y evaluable sin trámites,
sin inventar datos atribuidos a personas reales.

Para ver el ladder real de LAN:

1. Entra a <https://developer.riotgames.com/> con tu cuenta de Riot y copia la
   **Development API Key** (empieza con `RGAPI-`).
2. Configúrala y arranca:

   ```bash
   cp .env.example .env      # y pega la clave en RIOT_API_KEY
   node servidor/proxy.mjs
   ```

   O en una sola línea, sin archivo:

   ```bash
   RIOT_API_KEY=RGAPI-xxxxxxxx node servidor/proxy.mjs
   ```

El chip de la barra superior pasa de `Datos demo` a `Datos en vivo`.

> Las claves de desarrollo **caducan cada 24 horas**. Cuando expira, Riot responde 401/403,
> el proxy lo registra en consola y la app cae a los datos de demostración con el motivo
> explicado en el aviso.

## Mi grupo de amigos

La pestaña **Mi grupo** es una segunda clasificación, aparte del ladder global: agregas los
Riot ID de tus amigos (`Nombre#TAG`) y la app los ordena por su rango en LAN, comparando
liga, división y LP en la cola que elijas.

- **Privado por diseño.** La lista vive en el `localStorage` del dispositivo; no hay cuentas
  ni base de datos. Cada rango descargado queda además en la Cache API, así que el grupo
  también se consulta sin conexión.
- **Compartir grupo** genera un enlace `?vista=grupo&amigos=...` usando la Web Share API
  (o el portapapeles como respaldo). Quien lo abre importa esos Riot ID en su dispositivo.
- **En modo demostración** (sin `RIOT_API_KEY`) cada Riot ID recibe un rango ficticio pero
  **determinista**: el mismo ID produce siempre la misma liga, así el grupo es comparable
  y demostrable. Con clave, un Riot ID inexistente devuelve un 404 real y no se agrega.
- Cada integrante cuesta **2 llamadas** a Riot (account-v1 + league-v4), con caché de
  10 minutos en el proxy. El grupo admite hasta 20 integrantes para cuidar la cuota de la
  clave de desarrollo.

## ¿Por qué hace falta un proxy?

La API de Riot no se puede llamar desde el navegador por dos razones independientes:

- No envía cabeceras CORS, así que `fetch` desde la página se bloquea.
- La clave viajaría en el código del cliente y quedaría a la vista de cualquiera.

La [documentación de las librerías de la API de Riot](https://riot-api-libraries.readthedocs.io/en/latest/mobile.html)
lo dice explícitamente: las llamadas del lado del cliente están bloqueadas y hace falta un
backend que guarde la clave. Ese backend es `servidor/proxy.mjs`, y además sirve los estáticos
para que la PWA y `/api/ranking` compartan origen (requisito para el alcance del service worker).

*Contenido reformulado para cumplir con las restricciones de licencia de la fuente.*

### Endpoints de Riot que se consumen

| Qué | Endpoint |
|---|---|
| Ladder de la élite | `GET https://{region}.api.riotgames.com/lol/league/v4/{challenger\|grandmaster\|master}leagues/by-queue/{cola}` |
| Ladder bajo Maestro | `GET https://{region}.api.riotgames.com/lol/league/v4/entries/{cola}/{tier}/{division}?page=1` |
| Riot ID desde el puuid | `GET https://{ruteo}.api.riotgames.com/riot/account/v1/accounts/by-puuid/{puuid}` |
| puuid desde el Riot ID (Mi grupo) | `GET https://{ruteo}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{nombre}/{tag}` |
| Rango de un jugador (Mi grupo) | `GET https://{region}.api.riotgames.com/lol/league/v4/entries/by-puuid/{puuid}` |
| Historial (Mi grupo) | `GET https://{ruteo}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids` + `GET .../matches/{id}` |

`{region}` es la plataforma elegida (`la1`, `kr`, `euw1`…) y `{ruteo}` su clúster regional
(`americas`, `europe`, `asia`, `sea`), que el proxy resuelve solo. Tres familias de API en
total: `ACCOUNT-V1`, `LEAGUE-V4` y `MATCH-V5`.

**Todos los jugadores, con nombres progresivos.** El listado devuelve todas las filas del
ladder (tope 500). Como cada Riot ID cuesta una llamada a `account-v1` y la clave de
desarrollo permite 100 peticiones cada 2 minutos, el proxy resuelve los primeros
`TOP_JUGADORES` nombres al momento y el resto en una cola en segundo plano (lotes de 5 cada
7 s); mientras tanto la interfaz muestra un marcador y una nota con cuántos faltan, y se van
completando en cada actualización.

El campo `summonerName` de `league-v4` quedó obsoleto en noviembre de 2023, cuando Riot
[migró a Riot ID](https://support-developer.riotgames.com/hc/en-us/articles/22698983117587-Summoner-Name-to-Riot-ID):
ahora las entradas del ladder traen `puuid` y el nombre visible se resuelve con `account-v1`.

Eso significa **una petición extra por jugador**. Como una clave de desarrollo permite
100 peticiones cada 2 minutos, `TOP_JUGADORES` vale 25 por defecto. El proxy además:

- guarda cada listado en memoria durante `TTL_SEGUNDOS` (600 por defecto);
- cachea los Riot ID 24 horas, porque casi nunca cambian;
- resuelve nombres en lotes de 5 con una pausa entre lotes;
- respeta el `Retry-After` de un 429 y no vuelve a intentarlo antes de tiempo;
- si Riot falla y tiene una respuesta vencida en memoria, sirve esa antes que un error.

## API del proxy

```
GET /api/ranking?region=la1&cola=RANKED_SOLO_5x5&tier=CHALLENGER
GET /api/ranking?region=kr&cola=RANKED_SOLO_5x5&tier=GOLD&division=II
GET /api/jugador?riotId=Nombre%23TAG&region=la1    # rango de un jugador (Mi grupo)
GET /api/historial?puuid=...&region=la1            # últimas partidas (Mi grupo)
GET /api/estado        # diagnóstico: clave, regiones, cachés, cola de nombres
```

`/api/jugador` responde `{ fuente, riotId, puuid, actualizado, colas: { RANKED_SOLO_5x5,
RANKED_FLEX_SR } }`, donde cada cola trae `{ tier, division, lp, victorias, derrotas, racha,
veterano, nuevo, inactivo }` o `null` si el jugador no está clasificado en ella. Un Riot ID
con formato inválido devuelve 400 y una cuenta inexistente devuelve 404 (solo con clave:
en demo cualquier ID válido recibe un rango ficticio estable).

`cola` ∈ `RANKED_SOLO_5x5`, `RANKED_FLEX_SR` · `tier` ∈ `CHALLENGER`, `GRANDMASTER`, `MASTER`.

Respuesta (misma forma en vivo y en demo, para que la interfaz no tenga dos caminos):

```json
{
  "fuente": "vivo",
  "region": "LAN",
  "plataforma": "la1",
  "cola": "RANKED_SOLO_5x5",
  "tier": "CHALLENGER",
  "actualizado": "2026-09-14T18:00:00.000Z",
  "total": 25,
  "jugadores": [
    {
      "puesto": 1, "riotId": "Nombre#TAG", "nombre": "Nombre", "tag": "TAG",
      "puuid": "...", "tier": "CHALLENGER", "division": "I", "lp": 1842,
      "victorias": 312, "derrotas": 241,
      "racha": true, "veterano": true, "nuevo": false, "inactivo": false
    }
  ]
}
```

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `RIOT_API_KEY` | — | Sin ella se sirven datos de demostración |
| `PUERTO` | `8080` | Puerto del servidor |
| `PLATAFORMA` | `la1` | `la1` = LAN, `la2` = LAS, `na1`, `br1`, `kr`, `euw1`… |
| `TOP_JUGADORES` | `25` | Jugadores por listado (cada uno = 1 petición a `account-v1`) |
| `TTL_SEGUNDOS` | `600` | Cuánto reutiliza el proxy una respuesta |

También como flags: `--puerto 8080`, `--top 30`.

## Estructura

```
ranking-lan/
├── index.html                 Interfaz
├── offline.html               Respaldo de navegación sin red ni caché
├── manifest.webmanifest       Identidad instalable: iconos, atajos, capturas
├── sw.js                      Service worker (precache + estrategias)
├── css/estilos.css
├── js/
│   ├── app.js                 Estado, eventos, pestañas, orquestación
│   ├── api.js                 Capa de datos: proxy → caché → demo
│   ├── amigos.js              Sección «Mi grupo»: altas, orden, historial, consejos, compartir
│   ├── i18n.js                Diccionarios ES/EN, t(), cambio de idioma en vivo
│   ├── ui.js                  Renderizado (todo con textContent)
│   └── registro-sw.js         Registro del SW, aviso de versión, instalación
├── datos/ranking-lan.json     Semilla de demostración (ficticia)
├── iconos/                    SVG fuente, PNG generados y capturas
├── servidor/proxy.mjs         Estáticos + proxy de la API de Riot
├── Dockerfile                 Imagen de producción (node:22-alpine, sin deps)
├── despliegue/
│   ├── plantilla.yaml         CloudFormation: Fargate + ALB (+ CloudFront)
│   ├── desplegar.sh           Construye, sube a ECR y despliega el stack
│   └── eliminar.sh            Borra toda la infraestructura
└── herramientas/
    ├── generar-iconos.sh      SVG → PNG con Chrome headless
    ├── generar-datos-demo.mjs Regenera la semilla de demostración
    └── verificar.mjs          Pruebas end-to-end vía Chrome DevTools Protocol
```

```bash
npm start          # = node servidor/proxy.mjs
npm run datos      # regenera datos/ranking-lan.json
npm run iconos     # regenera los PNG desde los SVG
```

## Qué la convierte en una PWA

| Requisito | Dónde está |
|---|---|
| Manifest con iconos, `display: standalone`, atajos y capturas | `manifest.webmanifest` |
| Icono *maskable* (para que Android no lo recorte mal) | `iconos/icono-maskable-512.png` |
| Service worker con precache del app shell | `sw.js` → `PRECACHE` |
| Funciona offline | Caché del shell + última clasificación descargada |
| Instalable con botón propio | `beforeinstallprompt` en `js/registro-sw.js` |
| Aviso de versión nueva sin recargas sorpresa | `SALTAR_ESPERA` + `controllerchange` con guarda |
| Compartir el grupo con un enlace | Web Share API con respaldo de portapapeles (`js/amigos.js`) |
| Responsiva y con `safe-area` | `css/estilos.css` |
| Accesible | HTML semántico, `aria-live`, foco visible, `prefers-reduced-motion` |
| Origen seguro | `localhost` en desarrollo, HTTPS en producción |

### Estrategias de caché

| Petición | Estrategia | Por qué |
|---|---|---|
| Navegación | Red primero → `index.html` en caché → `offline.html` | El HTML debe poder cambiar |
| `/api/ranking` | Red primero → caché marcada con `X-Ranking-Origen: cache` | Un ranking viejo es útil, pero hay que decir que es viejo |
| `datos/*.json` | *Stale-while-revalidate* | Pinta ya y se actualiza detrás |
| CSS, JS, iconos | Caché primero + revalidación en segundo plano | Tienen nombre estable |

Cuando el service worker responde desde su caché por falta de red, añade la cabecera
`X-Ranking-Origen: cache`. `js/api.js` la lee para mostrar *Desde caché* en lugar de
*Datos en vivo*: la interfaz nunca presenta datos viejos como frescos.

Al desplegar un cambio, **sube `VERSION` en `sw.js`** para que se borren los cachés anteriores.

## Probarla

### Verificación automática

```bash
node servidor/proxy.mjs --puerto 8137 &
node herramientas/verificar.mjs --url http://localhost:8137/
```

Levanta Chrome headless y comprueba en un navegador real el render, los filtros, el diálogo
de detalle, la sección Mi grupo (altas, orden por rango, duplicados, persistencia, quitar),
el manifest, el registro y el precache del service worker, y que tanto el ladder como el
grupo sigan abriendo con la red desconectada. También regenera las capturas del manifest.

### A mano

- **Instalar**: en Chrome o Edge, el icono de instalación de la barra de direcciones, o el
  botón *Instalar app* de la cabecera. En iOS, *Compartir → Añadir a pantalla de inicio*.
- **Offline**: DevTools → *Network* → *Offline* → recarga. La app abre igual y el chip cambia
  a *Sin conexión*.
- **Auditar**: DevTools → *Lighthouse* → categoría *Progressive Web App*.
- **Inspeccionar**: DevTools → *Application* → *Service Workers* y *Cache Storage*.

## Desplegar

### AWS: Fargate + ALB (+ CloudFront para HTTPS)

El proyecto incluye todo lo necesario en `despliegue/`:

```bash
bash despliegue/desplegar.sh                     # modo demo, con HTTPS (CloudFront)
bash despliegue/desplegar.sh --clave RGAPI-...   # con datos reales de Riot
bash despliegue/desplegar.sh --https no          # solo ALB, sin CloudFront
bash despliegue/eliminar.sh                      # borrar TODO (dejar de pagar)
```

El script construye la imagen (`Dockerfile`, sin dependencias), la sube a ECR y
despliega `despliegue/plantilla.yaml` con CloudFormation: cluster de ECS, tarea
Fargate (0.25 vCPU / 512 MB, ARM64 si construyes en Apple Silicon), Application
Load Balancer con health check en `/api/estado`, security groups (la tarea solo
acepta tráfico del ALB), logs con retención de 7 días y, opcionalmente, una
distribución de CloudFront.

Detalles que importan:

- **HTTPS no es opcional para una PWA.** El DNS del ALB solo sirve HTTP, y sin
  contexto seguro el navegador no registra el service worker ni ofrece instalar
  la app. Por eso la plantilla pone CloudFront delante (HTTPS gratis en
  `*.cloudfront.net`): usa esa URL para la demo. La del ALB queda como acceso
  directo y para depurar.
- **La clave vive en Secrets Manager, nunca en texto plano.** No entra en la
  imagen (`.dockerignore` excluye `.env`), no pasa por parámetros de
  CloudFormation y no aparece en la task definition: ahí solo queda el ARN del
  secreto, que ECS lee al arrancar la tarea (`secrets`/`valueFrom`) con un rol
  que únicamente puede leer ese secreto. Cuesta ~0.40 USD/mes.
  Para la rotación diaria (las claves de desarrollo caducan cada 24 h) no hace
  falta re-desplegar: `desplegar.sh --clave RGAPI-nueva`, o directamente

  ```bash
  SECRETO=$(aws cloudformation describe-stacks --stack-name ranking-lan \
    --query "Stacks[0].Outputs[?OutputKey=='ArnSecretoClave'].OutputValue" --output text)
  aws secretsmanager put-secret-value --secret-id "$SECRETO" \
    --secret-string '{"RIOT_API_KEY":"RGAPI-nueva"}'
  aws ecs update-service --cluster ranking-lan --service ranking-lan --force-new-deployment
  ```

  `desplegar.sh --demo` vacía el secreto y la app vuelve al modo demostración.
- **CloudFront no cachea `/api/*`** (política CachingDisabled con query strings
  íntegras); los estáticos usan CachingOptimized y el script invalida el borde
  en cada actualización.
- **Costo aproximado** si queda encendido: ALB ~18 USD/mes + Fargate ARM
  ~6 USD/mes. `eliminar.sh` borra el stack completo cuando termines de mostrarla.

### Solo demo, sin AWS

Sube la carpeta a cualquier hosting estático. `/api/ranking` dará 404 y
`js/api.js` caerá solo a `datos/ranking-lan.json`. Si no lo publicas en la raíz
del dominio, ajusta `id` en `manifest.webmanifest` (las demás rutas ya son
relativas).

## Soporte por navegador

Verificado a septiembre de 2026:

- **Instalación**: Chrome, Edge y Safari (escritorio y iOS) la instalan. En Firefox de
  escritorio la instalación es experimental desde la versión 143, solo en Windows y desactivada
  por defecto.
- **Notificaciones push**: en iOS solo funcionan si la PWA ya está instalada en la pantalla de
  inicio (Safari 16.4+). Esta app no usa push.
- **Background Sync**: no existe en Gecko ni en WebKit, así que esta app no depende de él; el
  refresco se hace al recuperar la conexión y al volver a la pestaña.

## Límites conocidos

- La clave de desarrollo caduca cada 24 horas y su cupo es bajo; por eso `TOP_JUGADORES` = 25.
  Para listados más largos hace falta una *Personal* o *Production API Key*.
- Riot no publica un endpoint de "top N global": hay que pedir la liga completa y ordenarla por
  LP, que es lo que hace el proxy (con tope de 500 filas por respuesta; Maestro en KR trae miles).
- Bajo Maestro se muestra la página 1 de `league-v4 entries` (~200 jugadores por división);
  paginar más allá multiplicaría las peticiones sin cambiar la demo.
- Los nombres del listado se completan de forma progresiva por el límite de la clave de
  desarrollo (ver arriba); los primeros del ladder llegan siempre resueltos. La cola en
  segundo plano gasta como máximo ~40 % del presupuesto (5 nombres cada 15 s) y un 429
  con `Retry-After` corto se reintenta una vez en silencio antes de degradar a demo.
- La semilla offline solo cubre la élite de LAN: otras regiones y ligas menores requieren red
  la primera vez (después quedan en la caché del service worker).
- Sin `RIOT_API_KEY` los datos son ficticios. Está señalizado en la interfaz, en el JSON
  (`"fuente": "demo"`) y en los propios Riot ID.
- La lista de Mi grupo es local a cada dispositivo (por diseño: sin cuentas ni servidor de
  datos). Compartir el enlace copia la lista, no la sincroniza.

## Aviso legal

Ranking LAN no está respaldado por Riot Games y no refleja las opiniones ni los puntos de vista
de Riot Games ni de nadie relacionado oficialmente con la producción o gestión de las propiedades
de Riot Games. Riot Games y todas las propiedades asociadas son marcas comerciales o marcas
registradas de Riot Games, Inc.

Proyecto académico · UTEC · Aplicaciones Web Progresivas.
