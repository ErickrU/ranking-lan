/**
 * Internacionalizacion de Ranking LAN.
 *
 * - t(clave, vars) devuelve la cadena del idioma activo, interpolando {vars}.
 * - Los textos estaticos del HTML declaran data-i18n="clave" (textContent) o
 *   data-i18n-attr="atributo:clave,atributo2:clave2" y se actualizan en bloque.
 * - Cambiar de idioma dispara el evento "idiomacambiado" para que app.js y
 *   amigos.js repinten lo dinamico. No hace falta recargar.
 *
 * Anadir un idioma = anadir un diccionario aqui y una <option> al selector.
 */

const CLAVE_IDIOMA = 'ranking-lan:idioma';

export const IDIOMAS = { es: 'Español', en: 'English' };

/** Locale de Intl para numeros y tiempos relativos. */
const LOCALES = { es: 'es-MX', en: 'en-US' };

const DICCIONARIOS = {
  /* ==================================================================== */
  es: {
    'app.sub': 'League of Legends · {region}',
    'idioma.etiqueta': 'Idioma',
    'boton.instalar': 'Instalar app',
    'boton.actualizar': 'Actualizar',
    'tabs.aria': 'Secciones de la aplicación',
    'tab.global': 'Ranking regional',
    'tab.grupo': 'Mi grupo',

    'conexion.enLinea': 'En línea',
    'conexion.sinConexion': 'Sin conexión',
    'fuente.vivo': 'Datos en vivo',
    'fuente.cache': 'Desde caché',
    'fuente.demo': 'Datos demo',
    'fuente.cargando': 'Cargando…',
    'estado.actualizado': 'Actualizado {tiempo}',
    'aviso.demo': 'Modo demostración.',

    'control.region': 'Región',
    'control.cola': 'Cola',
    'control.liga': 'Liga',
    'control.division': 'División',
    'control.orden': 'Ordenar por',
    'control.buscar': 'Buscar jugador',
    'buscar.placeholder': 'Riot ID, p. ej. Jaguar',
    'cola.RANKED_SOLO_5x5': 'Solo / Dúo',
    'cola.RANKED_FLEX_SR': 'Flexible',
    'orden.lp-desc': 'LP (mayor a menor)',
    'orden.lp-asc': 'LP (menor a mayor)',
    'orden.wr-desc': 'Winrate',
    'orden.partidas-desc': 'Partidas jugadas',
    'orden.nombre-asc': 'Nombre (A-Z)',

    'tier.CHALLENGER': 'Retador',
    'tier.GRANDMASTER': 'Gran Maestro',
    'tier.MASTER': 'Maestro',
    'tier.DIAMOND': 'Diamante',
    'tier.EMERALD': 'Esmeralda',
    'tier.PLATINUM': 'Platino',
    'tier.GOLD': 'Oro',
    'tier.SILVER': 'Plata',
    'tier.BRONZE': 'Bronce',
    'tier.IRON': 'Hierro',
    'tier.UNRANKED': 'Sin clasificar',

    'region.la1': 'LAN · Latinoamérica Norte',
    'region.la2': 'LAS · Latinoamérica Sur',
    'region.na1': 'NA · Norteamérica',
    'region.br1': 'BR · Brasil',
    'region.euw1': 'EUW · Europa Oeste',
    'region.eun1': 'EUNE · Europa Nórdica y Este',
    'region.tr1': 'TR · Turquía',
    'region.ru': 'RU · Rusia',
    'region.me1': 'ME · Medio Oriente',
    'region.kr': 'KR · Corea',
    'region.jp1': 'JP · Japón',
    'region.oc1': 'OCE · Oceanía',
    'region.sg2': 'SEA · Singapur',
    'region.tw2': 'TW · Taiwán',
    'region.vn2': 'VN · Vietnam',

    'resumen.aria': 'Resumen de la liga',
    'resumen.jugadores': 'Jugadores',
    'resumen.lpMax': 'LP más alto',
    'resumen.lpMin': 'LP más bajo',
    'resumen.wr': 'Winrate promedio',

    'podio.aria': 'Los tres primeros puestos',
    'podio.detalle': '{partidas} partidas · {wr} de victorias',
    'podio.tarjeta': 'Puesto {puesto}: {riotId}, {lp} LP',

    'tabla.titulo': 'Clasificación',
    'tabla.caption': 'Ranking de jugadores de League of Legends en la región seleccionada, ordenado según el filtro elegido. Enter sobre un jugador abre su detalle.',
    'th.jugador': 'Jugador',
    'th.liga': 'Liga',
    'th.vd': 'V / D',
    'th.winrate': 'Winrate',
    'th.quitar': 'Quitar',
    'conteo.total': '{total} jugadores en el listado',
    'conteo.busqueda': '{visibles} de {total} jugadores coinciden con "{busqueda}"',
    'conteo.sinResultados': 'Sin resultados para "{busqueda}"',
    'tabla.nombresPendientes': '{n} nombres siguen resolviéndose (límite de la API de Riot); aparecerán al actualizar.',
    'tabla.invocador': 'Invocador',
    'vacio.busqueda': 'Ningún jugador coincide con la búsqueda.',
    'vacio.sinDatos': 'No hay datos disponibles para esta combinación. Conéctate a internet y vuelve a intentarlo.',
    'cargando.listado': 'Consultando el ladder…',
    'detalle.abrirAria': 'Ver detalle de {riotId}',

    'insignia.racha': '🔥 En racha',
    'insignia.veterano': 'Veterano',
    'insignia.nuevo': 'Recién llegado',
    'insignia.inactivo': 'Inactivo',

    'dialogo.cerrar': 'Cerrar detalle',
    'dialogo.puesto': 'Puesto {puesto}',
    'dialogo.lp': 'Puntos de liga (LP)',
    'dialogo.partidas': 'Partidas jugadas',
    'dialogo.victorias': 'Victorias',
    'dialogo.derrotas': 'Derrotas',
    'dialogo.winrate': 'Winrate',
    'dialogo.percentil': 'Top {pct} % de este listado',
    'dialogo.barra': '{wr} de victorias',

    'grupo.titulo': 'Mi grupo de amigos',
    'grupo.nota': 'Se guarda solo en este dispositivo',
    'grupo.intro': 'Agrega los Riot ID de tus amigos y compáralos en una clasificación propia, aparte del ranking regional: liga, división y LP deciden el orden. Nadie más ve tu lista; puedes enviarla con «Compartir grupo».',
    'grupo.nombre': 'Nombre',
    'grupo.tag': 'Tag',
    'grupo.nombrePlaceholder': 'VicunaSereno',
    'grupo.tagPlaceholder': 'LAN1',
    'grupo.agregar': 'Agregar',
    'grupo.tituloTabla': 'Clasificación del grupo',
    'grupo.caption': 'Rangos de los integrantes de tu grupo, ordenados del rango más alto al más bajo según liga, división y puntos de liga.',
    'grupo.actualizar': 'Actualizar rangos',
    'grupo.compartir': '🔗 Compartir grupo',
    'grupo.vacio': 'Tu grupo está vacío. Agrega el primer Riot ID arriba para empezar a comparar rangos.',
    'grupo.consultando': 'Consultando rangos…',
    'grupo.integrantes': '{n} integrante{plural}',
    'grupo.quitarAria': 'Quitar a {riotId} del grupo',
    'grupo.sinDatos': 'Sin datos',
    'nota.vivo': 'datos en vivo',
    'nota.cache': 'incluye datos de caché',
    'nota.demo': 'datos de demostración',
    'nota.sinDatos': 'sin datos',
    'nota.actualizado': 'actualizado {tiempo}',

    'msj.nombreInvalido': 'El nombre debe tener de 1 a 16 caracteres y no puede incluir #.',
    'msj.tagInvalido': 'El tag tiene de 2 a 5 letras o números.',
    'msj.yaEsta': '{riotId} ya está en el grupo.',
    'msj.limite': 'El grupo admite hasta {max} integrantes.',
    'msj.consultando': 'Consultando a {riotId}…',
    'msj.seUnio': '{riotId} se unió al grupo.',
    'msj.salio': '{riotId} salió del grupo.',
    'msj.noComprobar': 'No se pudo comprobar ese Riot ID ({error}). Inténtalo con conexión.',
    'msj.compartirVacio': 'Agrega al menos un integrante antes de compartir.',
    'msj.enlaceCopiado': 'Enlace del grupo copiado al portapapeles.',
    'msj.noCompartir': 'No se pudo compartir: {error}',

    'historial.titulo': 'Últimas partidas',
    'historial.cargando': 'Buscando partidas recientes…',
    'historial.vacio': 'Sin partidas de clasificatoria recientes.',
    'historial.error': 'No se pudo cargar el historial ({error}).',
    'historial.v': 'V',
    'historial.d': 'D',
    'historial.min': '{min} min',
    'posicion.TOP': 'Top',
    'posicion.JUNGLE': 'Jungla',
    'posicion.MIDDLE': 'Medio',
    'posicion.BOTTOM': 'Tirador',
    'posicion.UTILITY': 'Soporte',

    'comp.titulo': 'Comparado con tu grupo',
    'comp.lp': 'LP vs. promedio',
    'comp.wr': 'Winrate vs. promedio',
    'comp.puesto': 'Puesto en el grupo',
    'comp.de': '{puesto} de {total}',
    'comp.pts': '{n} pts',

    'consejos.titulo': 'Para ganar más',
    'consejo.winrateBajo': 'Tu winrate ({wr} %) está {dif} puntos bajo el promedio del grupo: prioriza los campeones que ya dominas en vez de experimentar en clasificatoria.',
    'consejo.winrateAlto': 'Winrate de {wr} %, por encima de tu grupo: te sobra margen, juega más partidas para convertirlo en LP.',
    'consejo.pocasPartidas': 'Llevas {n} partidas y el promedio del grupo es {prom}: con poca muestra el LP se mueve lento, juega más seguido.',
    'consejo.muereMenos': 'Promedias {muertes} muertes en tus últimas partidas: muere menos y el winrate sube casi solo.',
    'consejo.farmea': 'Tu CS/min reciente es {cs}: subirlo hacia 6 o más es oro gratis que no depende de tu equipo.',
    'consejo.racha': 'Estás en racha: encadena partidas hoy mismo, ese impulso no se guarda para mañana.',
    'consejo.derrotas': 'Vienes de {n} derrotas seguidas: corta la sesión y vuelve mañana, el tilt es real.',
    'consejo.duo': 'Haz dúo con {nombre}, el mejor winrate del grupo ({wr} %): subir acompañado es más fácil.',
    'consejo.inactivo': 'Apareces como inactivo: juega al menos una partida para no perder LP por descomposición.',
    'consejo.general': 'Números sanos comparados con tu grupo: constancia y una pool corta de campeones es lo que queda.',

    'pwa.resumen': '¿Cómo funciona esta PWA?',
    'pwa.i1.t': 'Instalable:',
    'pwa.i1.d': 'el manifest permite añadirla a la pantalla de inicio y abrirla en su propia ventana.',
    'pwa.i2.t': 'Funciona offline:',
    'pwa.i2.d': 'un service worker guarda el app shell y la última clasificación descargada.',
    'pwa.i3.t': 'Datos frescos:',
    'pwa.i3.d': 'las peticiones de datos van primero a la red y, si falla, sirven la copia en caché.',
    'pwa.i4.t': 'Clave protegida:',
    'pwa.i4.d': 'la API de Riot no se puede llamar desde el navegador; un proxy en Node guarda la clave del lado del servidor.',
    'pwa.i5.t': 'Tu grupo, en tu dispositivo:',
    'pwa.i5.d': 'los Riot ID de «Mi grupo» viven en localStorage y sus rangos en la Cache API, también sin conexión.',

    'toast.nuevaVersion': 'Hay una versión nueva disponible.',
    'toast.recargar': 'Recargar',
    'sw.noSoportado': 'no soportado por este navegador (la app funciona, pero sin modo offline)',
    'sw.activo': 'activo · contenido disponible offline',
    'sw.instalando': 'instalando…',
    'sw.descargando': 'descargando actualización…',
    'sw.nuevaVersion': 'nueva versión lista para instalarse',
    'sw.error': 'no se pudo registrar ({error})',

    'pie.legal': 'Ranking LAN no está respaldado por Riot Games y no refleja las opiniones ni los puntos de vista de Riot Games ni de nadie relacionado oficialmente con la producción o gestión de las propiedades de Riot Games. Riot Games y todas las propiedades asociadas son marcas comerciales o marcas registradas de Riot Games, Inc.',
    'pie.meta1': 'Proyecto académico UTEC · Aplicaciones Web Progresivas · datos vía',
    'pie.meta2': '(league-v4, account-v1 y match-v5)',
  },

  /* ==================================================================== */
  en: {
    'app.sub': 'League of Legends · {region}',
    'idioma.etiqueta': 'Language',
    'boton.instalar': 'Install app',
    'boton.actualizar': 'Refresh',
    'tabs.aria': 'App sections',
    'tab.global': 'Regional ranking',
    'tab.grupo': 'My group',

    'conexion.enLinea': 'Online',
    'conexion.sinConexion': 'Offline',
    'fuente.vivo': 'Live data',
    'fuente.cache': 'From cache',
    'fuente.demo': 'Demo data',
    'fuente.cargando': 'Loading…',
    'estado.actualizado': 'Updated {tiempo}',
    'aviso.demo': 'Demo mode.',

    'control.region': 'Region',
    'control.cola': 'Queue',
    'control.liga': 'League',
    'control.division': 'Division',
    'control.orden': 'Sort by',
    'control.buscar': 'Search player',
    'buscar.placeholder': 'Riot ID, e.g. Jaguar',
    'cola.RANKED_SOLO_5x5': 'Solo / Duo',
    'cola.RANKED_FLEX_SR': 'Flex',
    'orden.lp-desc': 'LP (high to low)',
    'orden.lp-asc': 'LP (low to high)',
    'orden.wr-desc': 'Win rate',
    'orden.partidas-desc': 'Games played',
    'orden.nombre-asc': 'Name (A-Z)',

    'tier.CHALLENGER': 'Challenger',
    'tier.GRANDMASTER': 'Grandmaster',
    'tier.MASTER': 'Master',
    'tier.DIAMOND': 'Diamond',
    'tier.EMERALD': 'Emerald',
    'tier.PLATINUM': 'Platinum',
    'tier.GOLD': 'Gold',
    'tier.SILVER': 'Silver',
    'tier.BRONZE': 'Bronze',
    'tier.IRON': 'Iron',
    'tier.UNRANKED': 'Unranked',

    'region.la1': 'LAN · Latin America North',
    'region.la2': 'LAS · Latin America South',
    'region.na1': 'NA · North America',
    'region.br1': 'BR · Brazil',
    'region.euw1': 'EUW · Europe West',
    'region.eun1': 'EUNE · Europe Nordic & East',
    'region.tr1': 'TR · Türkiye',
    'region.ru': 'RU · Russia',
    'region.me1': 'ME · Middle East',
    'region.kr': 'KR · Korea',
    'region.jp1': 'JP · Japan',
    'region.oc1': 'OCE · Oceania',
    'region.sg2': 'SEA · Singapore',
    'region.tw2': 'TW · Taiwan',
    'region.vn2': 'VN · Vietnam',

    'resumen.aria': 'League summary',
    'resumen.jugadores': 'Players',
    'resumen.lpMax': 'Highest LP',
    'resumen.lpMin': 'Lowest LP',
    'resumen.wr': 'Average win rate',

    'podio.aria': 'Top three players',
    'podio.detalle': '{partidas} games · {wr} win rate',
    'podio.tarjeta': 'Rank {puesto}: {riotId}, {lp} LP',

    'tabla.titulo': 'Ranking',
    'tabla.caption': 'League of Legends player ranking for the selected region, sorted by the chosen filter. Press Enter on a player to open their details.',
    'th.jugador': 'Player',
    'th.liga': 'League',
    'th.vd': 'W / L',
    'th.winrate': 'Win rate',
    'th.quitar': 'Remove',
    'conteo.total': '{total} players listed',
    'conteo.busqueda': '{visibles} of {total} players match "{busqueda}"',
    'conteo.sinResultados': 'No results for "{busqueda}"',
    'tabla.nombresPendientes': '{n} names are still resolving (Riot API rate limit); they will appear on refresh.',
    'tabla.invocador': 'Summoner',
    'vacio.busqueda': 'No player matches your search.',
    'vacio.sinDatos': 'No data available for this combination. Go online and try again.',
    'cargando.listado': 'Fetching the ladder…',
    'detalle.abrirAria': 'View details for {riotId}',

    'insignia.racha': '🔥 Hot streak',
    'insignia.veterano': 'Veteran',
    'insignia.nuevo': 'Fresh blood',
    'insignia.inactivo': 'Inactive',

    'dialogo.cerrar': 'Close details',
    'dialogo.puesto': 'Rank {puesto}',
    'dialogo.lp': 'League points (LP)',
    'dialogo.partidas': 'Games played',
    'dialogo.victorias': 'Wins',
    'dialogo.derrotas': 'Losses',
    'dialogo.winrate': 'Win rate',
    'dialogo.percentil': 'Top {pct}% of this list',
    'dialogo.barra': '{wr} win rate',

    'grupo.titulo': 'My friends group',
    'grupo.nota': 'Stored only on this device',
    'grupo.intro': 'Add your friends by Riot ID and compare them in a private ranking, separate from the regional ladder: tier, division and LP decide the order. Nobody else sees your list; share it with “Share group”.',
    'grupo.nombre': 'Game name',
    'grupo.tag': 'Tag',
    'grupo.nombrePlaceholder': 'VicunaSereno',
    'grupo.tagPlaceholder': 'LAN1',
    'grupo.agregar': 'Add',
    'grupo.tituloTabla': 'Group ranking',
    'grupo.caption': 'Ranks of your group members, ordered from highest to lowest by tier, division and league points.',
    'grupo.actualizar': 'Refresh ranks',
    'grupo.compartir': '🔗 Share group',
    'grupo.vacio': 'Your group is empty. Add the first Riot ID above to start comparing ranks.',
    'grupo.consultando': 'Fetching ranks…',
    'grupo.integrantes': '{n} member{plural}',
    'grupo.quitarAria': 'Remove {riotId} from the group',
    'grupo.sinDatos': 'No data',
    'nota.vivo': 'live data',
    'nota.cache': 'includes cached data',
    'nota.demo': 'demo data',
    'nota.sinDatos': 'no data',
    'nota.actualizado': 'updated {tiempo}',

    'msj.nombreInvalido': 'The name must be 1–16 characters and cannot include #.',
    'msj.tagInvalido': 'The tag is 2–5 letters or digits.',
    'msj.yaEsta': '{riotId} is already in the group.',
    'msj.limite': 'The group allows up to {max} members.',
    'msj.consultando': 'Looking up {riotId}…',
    'msj.seUnio': '{riotId} joined the group.',
    'msj.salio': '{riotId} left the group.',
    'msj.noComprobar': 'Could not verify that Riot ID ({error}). Try again while online.',
    'msj.compartirVacio': 'Add at least one member before sharing.',
    'msj.enlaceCopiado': 'Group link copied to the clipboard.',
    'msj.noCompartir': 'Could not share: {error}',

    'historial.titulo': 'Recent matches',
    'historial.cargando': 'Looking up recent matches…',
    'historial.vacio': 'No recent ranked matches.',
    'historial.error': 'Could not load match history ({error}).',
    'historial.v': 'W',
    'historial.d': 'L',
    'historial.min': '{min} min',
    'posicion.TOP': 'Top',
    'posicion.JUNGLE': 'Jungle',
    'posicion.MIDDLE': 'Mid',
    'posicion.BOTTOM': 'Bot',
    'posicion.UTILITY': 'Support',

    'comp.titulo': 'Compared with your group',
    'comp.lp': 'LP vs. average',
    'comp.wr': 'Win rate vs. average',
    'comp.puesto': 'Rank within group',
    'comp.de': '{puesto} of {total}',
    'comp.pts': '{n} pts',

    'consejos.titulo': 'To win more',
    'consejo.winrateBajo': 'Your win rate ({wr}%) is {dif} points below the group average: stick to champions you already master instead of experimenting in ranked.',
    'consejo.winrateAlto': '{wr}% win rate, above your group: you have room to climb, play more games to turn it into LP.',
    'consejo.pocasPartidas': 'You have {n} games while the group averages {prom}: with a small sample LP moves slowly, play more often.',
    'consejo.muereMenos': 'You average {muertes} deaths in your recent games: die less and your win rate climbs almost on its own.',
    'consejo.farmea': 'Your recent CS/min is {cs}: pushing it toward 6+ is free gold that does not depend on your team.',
    'consejo.racha': 'You are on a hot streak: chain games today, that momentum does not carry over to tomorrow.',
    'consejo.derrotas': 'You just lost {n} in a row: end the session and come back tomorrow, tilt is real.',
    'consejo.duo': 'Duo with {nombre}, the best win rate in your group ({wr}%): climbing together is easier.',
    'consejo.inactivo': 'You show as inactive: play at least one game to avoid LP decay.',
    'consejo.general': 'Healthy numbers compared with your group: consistency and a short champion pool are all that is left.',

    'pwa.resumen': 'How does this PWA work?',
    'pwa.i1.t': 'Installable:',
    'pwa.i1.d': 'the manifest lets you add it to your home screen and open it in its own window.',
    'pwa.i2.t': 'Works offline:',
    'pwa.i2.d': 'a service worker caches the app shell and the last downloaded ranking.',
    'pwa.i3.t': 'Fresh data:',
    'pwa.i3.d': 'data requests go network-first and fall back to the cached copy.',
    'pwa.i4.t': 'Protected key:',
    'pwa.i4.d': 'the Riot API cannot be called from the browser; a Node proxy keeps the key server-side.',
    'pwa.i5.t': 'Your group, on your device:',
    'pwa.i5.d': '“My group” Riot IDs live in localStorage and their ranks in the Cache API, offline too.',

    'toast.nuevaVersion': 'A new version is available.',
    'toast.recargar': 'Reload',
    'sw.noSoportado': 'not supported by this browser (the app works, but without offline mode)',
    'sw.activo': 'active · content available offline',
    'sw.instalando': 'installing…',
    'sw.descargando': 'downloading update…',
    'sw.nuevaVersion': 'new version ready to install',
    'sw.error': 'could not register ({error})',

    'pie.legal': 'Ranking LAN isn’t endorsed by Riot Games and doesn’t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.',
    'pie.meta1': 'UTEC academic project · Progressive Web Apps · data via',
    'pie.meta2': '(league-v4, account-v1 and match-v5)',
  },
};

/* ------------------------------------------------------------------ */

let idioma = 'es';
try {
  const guardado = localStorage.getItem(CLAVE_IDIOMA);
  if (guardado in DICCIONARIOS) idioma = guardado;
} catch { /* modo privado */ }

/** Idioma activo ('es' | 'en'). */
export const idiomaActual = () => idioma;

/** Locale de Intl del idioma activo. */
export const localeActual = () => LOCALES[idioma] ?? 'es-MX';

/** Traduce una clave interpolando {variables}. */
export function t(clave, vars) {
  let texto = DICCIONARIOS[idioma][clave] ?? DICCIONARIOS.es[clave] ?? clave;
  if (vars) {
    for (const [nombre, valor] of Object.entries(vars)) {
      texto = texto.replaceAll(`{${nombre}}`, String(valor));
    }
  }
  return texto;
}

/** Recorre el DOM y aplica las claves declaradas en data-i18n / data-i18n-attr. */
export function aplicarEstaticos(raiz = document) {
  for (const nodo of raiz.querySelectorAll('[data-i18n]')) {
    nodo.textContent = t(nodo.dataset.i18n);
  }
  for (const nodo of raiz.querySelectorAll('[data-i18n-attr]')) {
    // formato: "placeholder:clave,aria-label:otra.clave"
    for (const par of nodo.dataset.i18nAttr.split(',')) {
      const [atributo, clave] = par.split(':').map((s) => s.trim());
      if (atributo && clave) nodo.setAttribute(atributo, t(clave));
    }
  }
}

/** Cambia el idioma, actualiza el DOM estatico y avisa al resto de la app. */
export function cambiarIdioma(nuevo) {
  if (!(nuevo in DICCIONARIOS) || nuevo === idioma) return;
  idioma = nuevo;
  try { localStorage.setItem(CLAVE_IDIOMA, nuevo); } catch { /* modo privado */ }
  document.documentElement.lang = nuevo;
  aplicarEstaticos();
  dispatchEvent(new CustomEvent('idiomacambiado', { detail: { idioma: nuevo } }));
}

/** Arranque: fija lang, traduce lo estatico y conecta el selector si existe. */
export function iniciarI18n() {
  document.documentElement.lang = idioma;
  aplicarEstaticos();

  const selector = document.querySelector('#sel-idioma');
  if (selector) {
    selector.value = idioma;
    selector.addEventListener('change', () => cambiarIdioma(selector.value));
    addEventListener('idiomacambiado', () => { selector.value = idioma; });
  }
}
