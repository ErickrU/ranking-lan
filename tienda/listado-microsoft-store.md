# Listado para la Microsoft Store · Ranking LAN

Textos listos para pegar en Partner Center (Apps y juegos → Ranking LAN → Listados de la Store →
Español). Los límites de caracteres son los de Partner Center a la fecha de redacción.

## Nombre

```
Ranking LAN
```

## Descripción corta (≤ 100 caracteres)

```
Ranking de League of Legends por región y liga, con tu grupo privado, builds, widget y avisos.
```

(94 caracteres)

## Descripción completa

```
Ranking LAN muestra la clasificación de League of Legends de tu región y de cualquier liga, desde
Hierro hasta Retador, con los Riot ID resueltos, los puntos de liga, las victorias y derrotas y el
winrate de cada jugador. Elige región (LAN, LAS, NA, BR, EUW, EUNE, KR, JP, OCE, TR, RU, ME, SEA,
TW y VN), cola (Solo/Dúo o Flexible) y liga, ordena por LP, partidas o winrate y busca un jugador
por su Riot ID.

Mi grupo: añade hasta 20 Riot ID de tus amigos y compáralos en una clasificación privada que vive
solo en tu dispositivo (sin cuentas ni registro). Abre el detalle de cada integrante para ver su
historial reciente, sus campeones más jugados, KDA, participación en kills, CS por minuto y
consejos generados a partir de sus propias partidas. Comparte la lista con un enlace.

Campeones y builds: catálogo completo con buscador y filtros, y para cada campeón la build que
usan los jugadores de la élite de tu región (objetos, runas, hechizos y orden de habilidades).

Hecho para Windows 11: la cabecera se integra en la barra de título de la ventana (Window
Controls Overlay) y el widget «Top 3 LAN» lleva el podio de tu región al panel de widgets.
Avisos y distintivos opcionales: si los activas, la app te avisa cuando alguien de tu grupo sube o
baja de liga o gana o pierde 20 LP o más, y cuando cambia el top 3 de la región y cola que sigues;
el número de cambios sin ver aparece como distintivo en el icono. El permiso se pide solo cuando
tú lo pulsas y no hay servidor de notificaciones: todo se genera en tu dispositivo.

Funciona sin conexión con los últimos datos descargados, en español e inglés, con tema claro u
oscuro, y respeta tu privacidad: sin analítica, sin publicidad, sin cookies ni rastreadores.

Ranking LAN isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

Ranking LAN no está respaldado por Riot Games y no refleja las opiniones ni los puntos de vista de
Riot Games ni de nadie relacionado oficialmente con la producción o gestión de las propiedades de
Riot Games. Riot Games y todas las propiedades asociadas son marcas comerciales o marcas
registradas de Riot Games, Inc.
```

## Características (una por línea en Partner Center)

```
Clasificación por región, cola y liga, de Hierro a Retador
Búsqueda por Riot ID y orden por LP, partidas o winrate
Mi grupo: clasificación privada de hasta 20 amigos guardada solo en tu dispositivo
Detalle de cada jugador: historial reciente, campeones más jugados, KDA y consejos
Campeones y builds de la élite de tu región
Widget «Top 3 LAN» para el panel de widgets de Windows 11
Avisos y distintivos opcionales por cambios de rango y del top 3
Funciona sin conexión con los últimos datos descargados
Español e inglés, tema claro y oscuro
Sin cuentas, analítica, publicidad ni rastreadores
```

## Términos de búsqueda (máximo 7)

```
League of Legends
LoL
ranking
ladder
clasificatoria
LAN
Riot ID
```

## Novedades de esta versión (1.0)

```
Primera versión en la Microsoft Store: ranking por región y liga, Mi grupo privado con historial
y consejos, campeones y builds de la élite, widget «Top 3 LAN» para Windows 11, avisos y
distintivos opcionales, funcionamiento sin conexión y soporte de español e inglés.
```

## Copyright y marcas

```
© 2026 Erick Alexander Rangel Urbina (ErickrU). Código bajo licencia MIT.
League of Legends y Riot Games son marcas comerciales o marcas registradas de Riot Games, Inc.
Ranking LAN no está respaldado por Riot Games.
```

## URLs

| Campo | Valor |
|---|---|
| Sitio web | https://d3b4s9lb316i67.cloudfront.net |
| Política de privacidad | https://d3b4s9lb316i67.cloudfront.net/privacidad.html |
| Contacto de soporte | https://github.com/ErickrU/ranking-lan/issues |

## Capacidades y justificación de `runFullTrust`

El paquete MSIX que genera PWABuilder para una PWA alojada declara la capacidad restringida
`runFullTrust`. Partner Center pide justificarla. Texto sugerido:

```
La capacidad runFullTrust la exige el paquete MSIX que genera PWABuilder para aplicaciones web
progresivas alojadas: el paquete lanza la app en Microsoft Edge en modo aplicación apuntando a
https://d3b4s9lb316i67.cloudfront.net/. La aplicación no usa esa capacidad para nada más: no
accede al sistema de archivos, no ejecuta código nativo, no instala servicios ni modifica el
sistema. Todo el código es web (HTML, CSS y JavaScript) y se ejecuta dentro del navegador.
```

No se declara ninguna otra capacidad. Las notificaciones, el distintivo y el widget usan las
API web estándar de Edge (Notifications, Badging, Periodic Background Sync y PWA Widgets).

## Categoría

**Entretenimiento**. No es un juego: es una app de consulta de estadísticas públicas de League of
Legends, así que no corresponde a «Juegos» (que exige además el flujo de certificación de
juegos). Si Partner Center ofrece subcategoría, dejarla vacía o elegir la más cercana a
«Deportes/estadísticas».

## Clasificación por edades (cuestionario IARC)

Respuestas **sugeridas** (confirmarlas al rellenar el cuestionario; el resultado lo emite IARC):

| Pregunta | Sugerencia |
|---|---|
| ¿Violencia? | No. La app muestra tablas, nombres de campeones y sus retratos oficiales; no hay escenas de juego |
| ¿Contenido sexual o desnudez? | No |
| ¿Lenguaje soez? | No |
| ¿Drogas, alcohol o tabaco? | No |
| ¿Apuestas o simulación de apuestas? | No |
| ¿Compras dentro de la app? | No |
| ¿Publicidad? | No |
| ¿Comparte la ubicación del usuario? | No |
| ¿Comparte información personal con terceros? | No |
| ¿Permite la comunicación entre usuarios? | No |
| ¿Contenido generado por usuarios visible para otros? | No. La lista «Mi grupo» es local; el enlace de compartir solo copia Riot ID |
| ¿Acceso a internet / contenido web? | Sí, solo a la API de la propia app y a los recursos oficiales de Riot (Data Dragon) |
| Otros | Muestra nombres públicos (Riot ID) de jugadores del ladder de Riot, tal y como los publica la API oficial |

Resultado esperado: apta para todos los públicos (IARC 3+ / PEGI 3 / ESRB Everyone). Tras la
certificación, copiar el `iarc_rating_id` al manifest (ver `publicacion.md`).

## Capturas (escritorio, 1920 × 1080)

Generadas con `node herramientas/capturas-tienda.mjs` contra **producción**
(https://d3b4s9lb316i67.cloudfront.net/): muestran **datos reales** de la API de Riot (chip «Datos en
vivo», sin banner de demostración). El grupo de la captura 02 es el top 3 real del ladder de LAN en
ese momento (los mismos Riot ID públicos del podio). En la 05, la lista «Últimos cambios» se pobló
con ejemplos ilustrativos para mostrar el formato de los avisos: tres Riot ID ficticios para los
cambios de grupo (no se atribuyen cambios a jugadores reales) y el top 3 real para el cambio de
ranking. El script aborta si la app sirve datos de demostración, así que las capturas nunca llevan
el chip «Datos demo». Los textos de abajo sirven como leyenda en Partner Center.

| Archivo | Leyenda sugerida |
|---|---|
| `capturas/01-ranking.png` | Ranking regional: filtros de región, cola y liga, podio y tabla con LP, V/D y winrate |
| `capturas/02-perfil-grupo.png` | Mi grupo: detalle de un integrante con rango, historial reciente, campeones más jugados y consejos |
| `capturas/03-campeones-build.png` | Campeones: ficha de Caitlyn con la build de la élite (objetos, runas, hechizos y habilidades) |
| `capturas/04-panel-widgets.png` | Widget «Top 3 LAN» para el panel de widgets de Windows 11 |
| `capturas/05-avisos.png` | Avisos y distintivos: activación opcional, prueba y lista de últimos cambios |
