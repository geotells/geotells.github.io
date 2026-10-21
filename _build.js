// Writes index.html (the app's page) and d.html (the same page under a daily
// challenge invitation, where shared results link to). Edit here, then run:
//
//   node _build.js
//
// Text goes in pairs: English in the page, Spanish in data-es (lang.js swaps
// it in on Spanish phones; it may hold <b>).
const fs = require('fs');

const apk = 'https://github.com/geotells/geotells.github.io/releases/latest/download/GeoTells.apk';
const site = 'https://geotells.com';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** An element with English inside and Spanish in data-es. */
const t = (tag, en, es, attrs = '') => `<${tag}${attrs ? ' ' + attrs : ''} data-es="${esc(es)}">${en}</${tag}>`;

const android = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22A11.5 11.5 0 0 0 12 8.2c-1.74 0-3.38.37-4.92.94L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/></svg>';

const shots = [
  ['Home: the daily challenge, the word of the day and the lessons', 'Inicio: el reto diario, la palabra del día y las lecciones'],
  ['A real car with its plate blurred: which country is it?', 'Un coche real con la matrícula difuminada: ¿de qué país es?'],
  ['Which writing is on the sign?', '¿Qué escritura hay en la señal?'],
  ['Missed it? The clue explained: yellow plates with the EU strip', '¿Fallaste? La pista explicada: matrículas amarillas con la franja de la UE'],
  ['Which country’s flag is this?', '¿De qué país es esta bandera?'],
  ['Find the country on the map', 'Encuentra el país en el mapa'],
  ['Your result, ready to share', 'Tu resultado, listo para compartir'],
];

const features = [
  ['Flags', 'Banderas'], ['Capitals', 'Capitales'], ['Alphabets', 'Alfabetos'], ['Driving side', 'Lado de conducción'],
  ['License plates', 'Matrículas'], ['Street View coverage', 'Cobertura de Street View'], ['Web domains', 'Dominios web'],
  ['Phone codes', 'Prefijos'], ['Daily challenge', 'Reto diario'], ['Word of the day', 'Palabra del día'],
];

// The short version, on the app's page; privacy.html has the whole of it.
const privacyPoints = [
  ['👤', 'No account and no sign-in.', 'Sin cuenta y sin registro.'],
  ['📱', 'Your progress is saved on your phone, with an anonymous copy on our server so it is not lost. You can turn it off in Settings.', 'Tu progreso se guarda en tu móvil, con una copia anónima en nuestro servidor para que no se pierda. Puedes desactivarla en Ajustes.'],
  ['🚫', 'No ads, no third-party analytics and no tracking.', 'Sin anuncios, sin analíticas de terceros y sin rastreo.'],
  ['📊', 'Once a day it anonymously notes that the app was opened, to count players. You can turn it off in Settings.', 'Una vez al día anota de forma anónima que se abrió la app, para contar jugadores. Puedes desactivarlo en Ajustes.'],
  ['🔔', 'Reminders, if you turn them on, go through our server: an anonymous identifier, your phone’s push address and when to send them.', 'Los recordatorios, si los activas, pasan por nuestro servidor: un identificador anónimo, la dirección push de tu móvil y cuándo enviarlos.'],
  ['✉️', 'When you report an error in a question, it sends that question, your comment and the app’s version.', 'Si notificas un error en una pregunta, envía esa pregunta, tu comentario y la versión de la app.'],
];

const email = 'hello@geotells.com';
const mail = `<a href="mailto:${email}">${email}</a>`;

// The privacy policy: sections of [English, Spanish] blocks. A block is a
// paragraph, or a list when it is an array of pairs.
const policy = [
  ['Data controller', 'Responsable del tratamiento', [
    [`GeoTells is a free application, with no advertising and no registration, developed by Damián Delgado, who is the controller of the personal data described in this policy. For any query or request regarding your personal data, please contact ${mail}.`,
     `GeoTells es una aplicación gratuita, sin publicidad y sin registro, desarrollada por Damián Delgado, responsable del tratamiento de los datos personales descritos en esta política. Para cualquier consulta o solicitud relativa a tus datos personales, puedes dirigirte a ${mail}.`],
  ]],
  ['Data stored on your device', 'Datos almacenados en tu dispositivo', [
    ['Your progress, streak, settings and reminder times are stored on your device, and are erased from it when the application is uninstalled or its data is cleared. Unless you turn it off, a copy of your progress is also kept on our server, as described under “Progress backup”.',
     'Tu progreso, tu racha, tus ajustes y los horarios de tus recordatorios se almacenan en tu dispositivo, y se eliminan de él al desinstalar la aplicación o borrar sus datos. Salvo que la desactives, también se conserva una copia de tu progreso en nuestro servidor, como se describe en «Copia del progreso».'],
    ['Data is transmitted outside your device only in the cases described below.',
     'Los datos solo se transmiten fuera de tu dispositivo en los supuestos que se describen a continuación.'],
  ]],
  ['Reminders', 'Recordatorios', [
    ['Android frequently delays alarms from applications that are used infrequently. For this reason, GeoTells delivers its reminders as push notifications. Only if you enable a reminder does the application:',
     'Android retiene con frecuencia las alarmas de las aplicaciones que se usan poco. Por este motivo, GeoTells envía sus recordatorios como notificaciones push. Únicamente si activas un recordatorio, la aplicación:'],
    [
      ['uses the anonymous identifier described under “Usage statistics” to connect to our server (Supabase), registering it if it does not yet exist;',
       'utiliza el identificador anónimo descrito en «Estadísticas de uso» para conectarse a nuestro servidor (Supabase), y lo crea si aún no existe;'],
      ['send it your device’s push address (a Firebase Cloud Messaging token) and the reminders scheduled for the following days, with their time and text.',
       'le envía la dirección push de tu dispositivo (un token de Firebase Cloud Messaging) y los recordatorios previstos para los próximos días, con su hora y su texto.'],
    ],
    ['At the scheduled time, the server sends each reminder through Firebase Cloud Messaging, a service provided by Google. This data is used exclusively to deliver the reminders you have requested. The legal basis for this processing is your consent, given when you enable reminders, which you may withdraw at any time by disabling them in Settings.',
     'A la hora prevista, el servidor envía cada recordatorio a través de Firebase Cloud Messaging, un servicio de Google. Estos datos se utilizan exclusivamente para enviarte los recordatorios que has solicitado. La base jurídica del tratamiento es tu consentimiento, prestado al activar los recordatorios, que puedes retirar en cualquier momento desactivándolos en Ajustes.'],
    ['Each reminder is deleted once it has been sent, and all pending reminders are deleted when you disable them. The push address is deleted after 90 days without the application being opened, or as soon as it ceases to be valid (for example, when the application is uninstalled).',
     'Cada recordatorio se elimina una vez enviado, y todos los pendientes se eliminan al desactivarlos. La dirección push se elimina transcurridos 90 días sin abrir la aplicación, o en cuanto deja de ser válida (por ejemplo, al desinstalarla).'],
    ['Supabase stores this data on servers located in London, United Kingdom, a country recognized by the European Union as providing an adequate level of protection. Google may process it in the United States under the EU-US Data Privacy Framework. On devices without Google Play services, reminders are handled entirely on the device and no data is transmitted.',
     'Supabase almacena estos datos en servidores ubicados en Londres (Reino Unido), país al que la Unión Europea reconoce un nivel de protección adecuado. Google puede tratarlos en Estados Unidos al amparo del Marco de Privacidad de Datos UE-EE. UU. En los dispositivos sin servicios de Google Play, los recordatorios se gestionan íntegramente en el dispositivo y no se transmite ningún dato.'],
  ]],
  ['Usage statistics', 'Estadísticas de uso', [
    ['To know how many people use GeoTells, once a day the application informs our server (Supabase) that it has been opened and which version it is running. To do so, it registers as an anonymous user, identified by a random identifier, without any name, email address or phone number. Nothing else is sent for this count: neither your answers nor your location.',
     'Para saber cuántas personas utilizan GeoTells, una vez al día la aplicación comunica a nuestro servidor (Supabase) que se ha abierto y qué versión ejecuta. Para ello se registra como usuario anónimo, mediante un identificador aleatorio, sin nombre, dirección de correo electrónico ni número de teléfono. Para este recuento no se envía ningún otro dato: ni tus respuestas ni tu ubicación.'],
    ['This information is used only to calculate aggregate figures, such as the number of daily, weekly and monthly active users. The legal basis is our legitimate interest in knowing how the application is used in order to maintain and improve it. You may object at any time by disabling “Count my days played” in Settings, which also deletes the days already recorded.',
     'Esta información se utiliza únicamente para obtener cifras agregadas, como el número de usuarios activos por día, semana y mes. La base jurídica es nuestro interés legítimo en conocer el uso de la aplicación para mantenerla y mejorarla. Puedes oponerte en cualquier momento desactivando «Contar mis días de juego» en Ajustes, lo que además elimina los días ya registrados.'],
    ['Each day recorded is deleted after 13 months. The data is stored on the Supabase servers in London described above.',
     'Cada día registrado se elimina transcurridos 13 meses. Los datos se almacenan en los servidores de Supabase en Londres descritos más arriba.'],
  ]],
  ['Progress backup', 'Copia del progreso', [
    ['So that your progress is not lost with your phone, the application sends a copy of it to our server (Supabase), under the anonymous identifier described under “Usage statistics”, together with the application version. The copy contains your game progress (experience points, level, streak, your results for each country and lesson, and your daily challenge and word of the day results) and nothing that identifies you. It is updated while you play and at least once a day when the application is opened.',
     'Para que tu progreso no se pierda con tu móvil, la aplicación envía una copia a nuestro servidor (Supabase), con el identificador anónimo descrito en «Estadísticas de uso», junto con la versión de la aplicación. La copia contiene tu progreso en el juego (puntos de experiencia, nivel, racha, tus resultados en cada país y lección, y los del reto diario y la palabra del día) y nada que te identifique. Se actualiza mientras juegas y, al menos, una vez al día al abrir la aplicación.'],
    ['In Settings you can obtain a transfer code to restore this copy on another device. Anyone who has the code can copy your progress, so keep it private.',
     'En Ajustes puedes obtener un código de traspaso para recuperar esta copia en otro dispositivo. Cualquiera que tenga el código puede copiar tu progreso, así que no lo compartas.'],
    ['GeoTells was previously called GeoSense. If you used GeoSense, its last version passes your transfer code to GeoTells, which then keeps your copy; from then on GeoSense no longer saves it. If GeoTells is not installed yet, GeoSense opens this website’s import page with the code after the “#” sign of the address, a part your browser never sends to the website.',
     'GeoTells se llamaba antes GeoSense. Si usabas GeoSense, su última versión pasa tu código de traspaso a GeoTells, que a partir de entonces conserva tu copia; desde ese momento, GeoSense deja de guardarla. Si GeoTells aún no está instalada, GeoSense abre la página de importación de este sitio web con el código tras el signo «#» de la dirección, una parte que tu navegador nunca envía al sitio web.'],
    ['The legal basis is our legitimate interest in providing the service you use without losing your progress. You may object at any time by disabling “Keep a copy online” in Settings, which deletes the copy immediately. A copy that has not been updated for two years is deleted. The data is stored on the Supabase servers in London described above.',
     'La base jurídica es nuestro interés legítimo en prestarte el servicio que utilizas sin que pierdas tu progreso. Puedes oponerte en cualquier momento desactivando «Guardar una copia en internet» en Ajustes, lo que elimina la copia de inmediato. Una copia que lleve dos años sin actualizarse se elimina. Los datos se almacenan en los servidores de Supabase en Londres descritos más arriba.'],
  ]],
  ['Daily challenge comparison', 'Comparativa del reto diario', [
    ['When you finish the daily challenge, the application sends your result to our server (Supabase), under the anonymous identifier described under “Usage statistics”: the challenge number, which questions you answered correctly and your thinking time. Nothing else is sent, and nothing that identifies you. Only the first result sent for each challenge is kept.',
     'Al terminar el reto diario, la aplicación envía tu resultado a nuestro servidor (Supabase), con el identificador anónimo descrito en «Estadísticas de uso»: el número del reto, qué preguntas acertaste y tu tiempo de reflexión. No se envía nada más, ni nada que te identifique. Solo se conserva el primer resultado enviado de cada reto.'],
    ['These results are used only to show each player aggregate figures for that challenge: the percentage of players they did better than, their position, how many players obtained each score and the percentage who answered each question correctly. No other player’s individual result is ever shown. The legal basis is our legitimate interest in offering this comparison, which is part of the game.',
     'Estos resultados se utilizan únicamente para mostrar a cada jugador cifras agregadas de ese reto: el porcentaje de jugadores a los que ha superado, su posición, cuántos jugadores obtuvieron cada puntuación y el porcentaje que acertó cada pregunta. Nunca se muestra el resultado individual de otro jugador. La base jurídica es nuestro interés legítimo en ofrecer esta comparativa, que forma parte del juego.'],
    ['Each result is deleted after 13 months. The data is stored on the Supabase servers in London described above.',
     'Cada resultado se elimina transcurridos 13 meses. Los datos se almacenan en los servidores de Supabase en Londres descritos más arriba.'],
  ]],
  ['Question reports', 'Notificación de errores en preguntas', [
    ['When you report a question you consider incorrect, the application sends: the question concerned (its wording, the options, the correct answer and the one you selected), the reason and any comment you provide, the application version, the Android version and device model, the language and certain settings (theme, map and level). This information does not identify you.',
     'Cuando notificas una pregunta que consideras errónea, la aplicación envía: la pregunta en cuestión (su enunciado, las opciones, la respuesta correcta y la que seleccionaste), el motivo y el comentario que añadas, la versión de la aplicación, la versión de Android y el modelo del dispositivo, el idioma y algunos ajustes (tema, mapa y nivel). Esta información no permite identificarte.'],
    ['The report is stored on our server (Supabase, on the London servers described above), together with the anonymous identifier described in “Usage statistics”, so that once the problem is fixed the application can thank you and add the corresponding XP to your progress. Earlier versions of the application send it through a Google Apps Script service, which passes it on to the same server. Only the developer can read reports. Please do not include personal data in your comments.',
     'El informe se guarda en nuestro servidor (Supabase, en los servidores de Londres descritos más arriba), junto con el identificador anónimo descrito en «Estadísticas de uso», para que, cuando el problema se corrija, la aplicación pueda darte las gracias y sumar a tu progreso los XP correspondientes. Las versiones anteriores de la aplicación lo envían a través de un servicio de Google Apps Script, que lo traslada al mismo servidor. Solo el desarrollador puede leer los informes. Te rogamos que no incluyas datos personales en los comentarios.'],
    ['Reports are used solely to correct the question concerned, on the basis of your consent, given by choosing to send them. They are retained until the issue is resolved, and for no longer than one year.',
     'Los informes se utilizan únicamente para corregir la pregunta afectada, sobre la base de tu consentimiento, prestado al decidir enviarlos. Se conservan hasta resolver la incidencia y, como máximo, durante un año.'],
  ]],
  ['Third-party services', 'Servicios de terceros', [
    ['Some questions display Street View imagery, loaded in real time from Google through the Google Maps SDK. In addition, on startup the application obtains a push address for the device from Firebase (Google), even if reminders are never enabled; this address is not sent to our server unless you enable them. In both cases your device connects to Google, which, as with any website, receives your IP address and certain technical data about the device, in accordance with the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>. GeoTells does not receive any of this data.',
     'Algunas preguntas muestran imágenes de Street View, cargadas en tiempo real desde Google mediante el SDK de Google Maps. Además, al iniciarse, la aplicación obtiene de Firebase (Google) una dirección push para el dispositivo, aunque nunca se activen los recordatorios; esta dirección no se envía a nuestro servidor salvo que los actives. En ambos casos, tu dispositivo se conecta a Google, que, como cualquier sitio web, recibe tu dirección IP y determinados datos técnicos del dispositivo, conforme a la <a href="https://policies.google.com/privacy">Política de privacidad de Google</a>. GeoTells no recibe ninguno de estos datos.'],
    ['This website and the application download are hosted on GitHub, which receives data of the same kind when you visit the site or download the application, in accordance with the <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">GitHub Privacy Statement</a>. This website does not use cookies.',
     'Este sitio web y la descarga de la aplicación están alojados en GitHub, que recibe datos de la misma naturaleza cuando visitas el sitio o descargas la aplicación, conforme a la <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">Declaración de privacidad de GitHub</a>. Este sitio web no utiliza cookies.'],
  ]],
  ['Use of data', 'Uso de los datos', [
    ['GeoTells does not display advertising, use third-party analytics tools or build user profiles. Your data is not sold or disclosed to third parties other than the service providers named in this policy, and only for the purposes described herein.',
     'GeoTells no muestra publicidad, no utiliza herramientas de analítica de terceros ni elabora perfiles de usuario. Tus datos no se venden ni se ceden a terceros distintos de los proveedores mencionados en esta política, y únicamente para los fines aquí descritos.'],
  ]],
  ['Minors', 'Menores de edad', [
    ['GeoTells is suitable for all ages and does not request any name, email address or account. Users under the age of 14 should obtain the permission of a parent or legal guardian before enabling reminders or sending a report.',
     'GeoTells es apta para todas las edades y no solicita nombre, dirección de correo electrónico ni cuenta. Los usuarios menores de 14 años deben contar con la autorización de sus padres o tutores legales antes de activar los recordatorios o enviar un informe.'],
  ]],
  ['Your rights', 'Tus derechos', [
    [`You may exercise your rights of access, rectification, erasure, restriction of processing, objection and data portability by writing to ${mail}. As this data is anonymous, the most direct way to erase it is to disable “Count my days played”, “Keep a copy online” and reminders in Settings (which deletes the days recorded, the copy of your progress and the reminders immediately) and then uninstall the application (the push address is deleted within 90 days).`,
     `Puedes ejercer tus derechos de acceso, rectificación, supresión, limitación del tratamiento, oposición y portabilidad escribiendo a ${mail}. Dado que estos datos son anónimos, la forma más directa de suprimirlos es desactivar «Contar mis días de juego», «Guardar una copia en internet» y los recordatorios en Ajustes (lo que elimina de inmediato los días registrados, la copia de tu progreso y los recordatorios) y, después, desinstalar la aplicación (la dirección push se elimina en un plazo de 90 días).`],
    ['If you consider that your data has not been processed lawfully, you may lodge a complaint with the Spanish Data Protection Agency (<a href="https://www.aepd.es">aepd.es</a>) or with the supervisory authority of your country.',
     'Si consideras que tus datos no se han tratado conforme a la normativa, puedes presentar una reclamación ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es">aepd.es</a>) o ante la autoridad de control de tu país.'],
  ]],
  ['Changes to this policy', 'Modificaciones de esta política', [
    ['Any changes to this policy will be published on this page, with the updated date shown at the top.',
     'Cualquier modificación de esta política se publicará en esta página, con la fecha de actualización indicada al inicio.'],
  ]],
];

function privacyPage() {
  const block = (b) => Array.isArray(b[0])
    ? `    <ul class="list">\n${b.map(([en, es]) => `      ${t('li', en, es)}`).join('\n')}\n    </ul>`
    : `    ${t('p', b[0], b[1])}`;
  return `<!doctype html>
<!-- Made by _build.js: edit that, not this. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoTells privacy policy</title>
<meta name="description" content="What GeoTells keeps on your phone, what it sends and why.">
<meta name="theme-color" content="#0b1324">
<link rel="icon" href="icon.png">
<link rel="stylesheet" href="style.css">
</head>
<body>
<main class="policy">
  <a class="back" href="./">${t('span', '← GeoTells', '← GeoTells')}</a>
  ${t('h1', 'Privacy policy', 'Política de privacidad')}
  ${t('p', 'Last updated: 21 October 2026', 'Última actualización: 21 de octubre de 2026', 'class="meta"')}
${policy.map(([en, es, blocks]) => `  <section>
    ${t('h3', en, es)}
${blocks.map(block).join('\n')}
  </section>`).join('\n')}
</main>
<script src="lang.js"></script>
</body>
</html>
`;
}

// The invitations on top of the app's page, for links shared with a result:
// d.html for the daily challenge, w.html for the word of the day.
const invites = {
  daily: {
    title: 'GeoTells daily challenge',
    description: 'Ten geography questions, the same for everyone today. Can you beat my score?',
    label: ['Daily challenge', 'Reto diario'],
    heading: ['Can you beat my score?', '¿Me superas?'],
    text: ['Ten geography questions, the same for everyone today. Install GeoTells and play today’s challenge.', 'Diez preguntas de geografía, las mismas para todos hoy. Instala GeoTells y juega el reto de hoy.'],
  },
  word: {
    title: 'GeoTells word of the day',
    description: 'A geography word in six tries, the same for everyone today. Can you guess it?',
    label: ['Word of the day', 'Palabra del día'],
    heading: ['Can you guess today’s word?', '¿Adivinas la palabra de hoy?'],
    text: ['A geography word in six tries, the same for everyone today. Install GeoTells and play today’s word.', 'Una palabra de geografía en seis intentos, la misma para todos hoy. Instala GeoTells y juega la palabra de hoy.'],
  },
};

function page({ invite }) {
  const shared = invites[invite];
  const title = shared ? shared.title : 'GeoTells: Learn the Metas';
  const description = shared
    ? shared.description
    : 'Learn the metas: flags, road lines, alphabets, driving side... the clues that tell where a photo was taken. A few minutes a day.';
  const ogDescription = shared ? description : 'Learn the clues that tell where a photo was taken, a few minutes a day.';
  return `<!doctype html>
<!-- Made by _build.js: edit that, not this. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${ogDescription}">
<!-- Small and square: WhatsApp shows it as a thumbnail beside the text, not a big banner. -->
<meta property="og:image" content="${site}/share.png">
<meta property="og:image:width" content="192">
<meta property="og:image:height" content="192">
<meta name="theme-color" content="#0b1324">
<link rel="icon" href="icon.png">
<link rel="stylesheet" href="style.css">
</head>
<body>
<main>
${shared ? `  <section class="invite">
    ${t('p', ...shared.label, 'class="eyebrow" id="label"')}
    ${t('h2', ...shared.heading)}
    ${t('p', ...shared.text)}
  </section>
` : ''}  <header class="app">
    <img class="logo" src="icon.png" alt="" width="76" height="76">
    <div>
      <h1>GeoTells</h1>
      ${t('p', 'Learn the metas', 'Aprende las metas', 'class="by"')}
    </div>
  </header>
  <ul class="facts">
    <li><b data-es="Gratis">Free</b>${t('span', 'price', 'precio')}</li>
    <li><b id="size">25 MB</b>${t('span', 'download', 'descarga')}</li>
    <li><b data-es="Sin anuncios">No ads</b>${t('span', 'ever', 'nunca')}</li>
    <li><b>EN · ES</b>${t('span', 'languages', 'idiomas')}</li>
  </ul>
  <a class="install" href="${apk}">${android}${t('span', 'Download for Android', 'Descargar para Android')}</a>
  ${t('p', 'Android 7.0 or later · no account needed', 'Android 7.0 o superior · sin crear cuenta', 'class="needs"')}

  <!-- store.js picks each image in the page's language; the browser picks
       the light or dark one, as the phone is set. -->
  <div class="shots" id="shots" aria-label="Screenshots">
${shots.map(([en, es], i) => `    <picture><source media="(prefers-color-scheme: light)"><img data-n="${i + 1}" alt="${esc(en)}" data-es-alt="${esc(es)}" width="540" height="1115"${i > 1 ? ' loading="lazy"' : ''}></picture>`).join('\n')}
  </div>

  <section>
    ${t('h3', 'About this app', 'Acerca de esta app')}
    ${t('p', 'On street-level photos, the clues to where you are hide in the details: the letters on the signs, the plates, the side of the road the cars drive on. GeoTells teaches them in short lessons, a few minutes a day, and a daily challenge to play with friends.', 'En las fotos a pie de calle, las pistas de dónde estás se esconden en los detalles: las letras de los carteles, las matrículas, el lado por el que circulan los coches. GeoTells te las enseña con lecciones cortas, unos minutos al día, y un reto diario para jugar con amigos.')}
    <ul class="chips">
${features.map(([en, es]) => `      ${t('li', en, es)}`).join('\n')}
    </ul>
  </section>

  <section>
    ${t('h3', 'What’s new', 'Novedades')}
    <p class="meta" id="release">Version 2.0.0</p>
    <ul class="list">
      ${t('li', 'GeoSense is now GeoTells: same game, new name.', 'GeoSense ahora es GeoTells: el mismo juego, con otro nombre.')}
      ${t('li', 'Bring your GeoSense progress along with one tap: your level, your streak and everything you have learned.', 'Trae tu progreso de GeoSense con un toque: tu nivel, tu racha y todo lo que has aprendido.')}
      ${t('li', 'Report a wrong question and get XP when it is fixed.', 'Avisa de una pregunta errónea y gana XP cuando se corrija.')}
    </ul>
  </section>

  <section class="from" id="geosense">
    ${t('h3', 'Coming from GeoSense?', '¿Vienes de GeoSense?')}
    ${t('p', 'GeoSense is now called GeoTells. Open GeoSense and tap <b>Move my progress to GeoTells</b>: it opens GeoTells with your progress, or brings you here to install it first. Or type your transfer code (GeoSense › Settings › <b>Transfer code</b>) in GeoTells: on its welcome screen, under <b>From GeoSense?</b>, or in its Settings.', 'GeoSense ahora se llama GeoTells. Abre GeoSense y pulsa <b>Pasar mi progreso a GeoTells</b>: abre GeoTells con tu progreso, o te trae aquí para instalarla antes. También puedes escribir tu código de traspaso (GeoSense › Ajustes › <b>Código de traspaso</b>) en GeoTells: en su pantalla de bienvenida, en <b>¿Vienes de GeoSense?</b>, o en sus Ajustes.')}
  </section>

  <section>
    ${t('h3', 'Privacy', 'Privacidad')}
    <ul class="privacy">
${privacyPoints.map(([icon, en, es]) => `      <li><span aria-hidden="true">${icon}</span>${t('span', en, es)}</li>`).join('\n')}
    </ul>
    <p class="more">${t('a', 'Read the privacy policy', 'Lee la política de privacidad', 'href="privacy"')}</p>
  </section>

  <details id="install">
    ${t('summary', 'How to install it', 'Cómo instalarla')}
    ${t('p', 'GeoTells is not on Google Play yet, so Android asks a few extra questions the first time. It is safe: say yes to them.', 'GeoTells aún no está en Google Play, así que Android hace alguna pregunta más la primera vez. Es segura: acepta.', 'class="note"')}
    <ol>
      ${t('li', 'Tap <b>Download for Android</b>. If the browser warns that the file could be harmful, tap <b>Download anyway</b>.', 'Pulsa <b>Descargar para Android</b>. Si el navegador avisa de que el archivo puede ser dañino, pulsa <b>Descargar de todos modos</b>.')}
      ${t('li', 'Open <b>GeoTells.apk</b>: from the download notification, or from the <b>Files</b> app, in Downloads.', 'Abre <b>GeoTells.apk</b>: desde el aviso de descarga, o desde la app <b>Archivos</b>, en Descargas.')}
      ${t('li', 'If it says your phone is not allowed to install unknown apps from this source, tap <b>Settings</b>, turn on <b>Allow from this source</b> and go back. This lets your browser (or the Files app) install apps; you can turn it off afterwards.', 'Si dice que tu móvil no puede instalar apps desconocidas de esta fuente, pulsa <b>Ajustes</b>, activa <b>Permitir de esta fuente</b> y vuelve atrás. Así das permiso al navegador (o a la app Archivos) para instalar apps; luego puedes quitarlo.')}
      ${t('li', 'If a security feature of your phone blocks the installation (some brands include an automatic blocker), turn it off for a moment in <b>Settings › Security</b>, install GeoTells and turn it back on.', 'Si alguna protección de seguridad del móvil bloquea la instalación (algunas marcas incluyen un bloqueador automático), desactívala un momento en <b>Ajustes › Seguridad</b>, instala GeoTells y vuelve a activarla.')}
      ${t('li', 'If <b>Google Play Protect</b> says it does not know the app, tap <b>More details</b> and then <b>Install anyway</b>.', 'Si <b>Google Play Protect</b> dice que no conoce la app, pulsa <b>Más detalles</b> y luego <b>Instalar de todos modos</b>.')}
      ${t('li', 'Tap <b>Install</b>, then <b>Open</b>. To update it later, download it again from here and install it over the old one: your progress stays.', 'Pulsa <b>Instalar</b> y luego <b>Abrir</b>. Para actualizarla más adelante, vuelve a descargarla desde aquí e instálala encima: no pierdes tu progreso.')}
    </ol>
  </details>

  ${t('p', 'GeoTells is an independent app, not affiliated with Google. Android is a trademark of Google LLC.', 'GeoTells es una app independiente, sin relación con Google. Android es una marca de Google LLC.', 'class="legal"')}
</main>
<script src="lang.js"></script>
<script src="store.js"></script>
</body>
</html>
`;
}

// importar.html: where GeoSense sends its players when GeoTells is not
// installed yet, with the transfer code after the # (geotells.com/importar#
// 7K2P9QXM4HTD; never sent to the site). importar.js shows the code and
// fills in the link that opens GeoTells with it.
function importPage() {
  return `<!doctype html>
<!-- Made by _build.js: edit that, not this. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Move from GeoSense to GeoTells</title>
<meta name="description" content="GeoSense is now GeoTells: install it and bring your progress along.">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#0b1324">
<link rel="icon" href="icon.png">
<link rel="stylesheet" href="style.css">
</head>
<body>
<main class="import">
  <header class="app">
    <img class="logo" src="icon.png" alt="" width="64" height="64">
    <div>
      <h1>GeoTells</h1>
      ${t('p', 'GeoSense’s new name', 'El nuevo nombre de GeoSense', 'class="by"')}
    </div>
  </header>

  <section class="invite">
    ${t('p', 'From GeoSense', 'Desde GeoSense', 'class="eyebrow"')}
    ${t('h2', 'Your progress is ready to move', 'Tu progreso está listo para pasar')}
    ${t('p', 'Install GeoTells and bring your level, your streak and everything you have learned.', 'Instala GeoTells y llévate tu nivel, tu racha y todo lo que has aprendido.')}
  </section>

  <section id="with-code" hidden>
    ${t('h3', 'Your transfer code', 'Tu código de traspaso')}
    <div class="code">
      <output id="code" aria-live="polite"></output>
      <button type="button" id="copy" class="copy" data-es="Copiar" data-es-done="Copiado">Copy</button>
    </div>
    ${t('p', 'Keep it to yourself: anyone with the code can copy your progress.', 'No lo compartas: cualquiera que tenga el código puede copiar tu progreso.', 'class="note"')}
  </section>

  <section id="no-code" hidden>
    ${t('h3', 'No code in this link', 'Este enlace no trae código')}
    ${t('p', 'Open GeoSense and tap <b>Move my progress to GeoTells</b> again, or find your code in GeoSense › Settings › <b>Transfer code</b>.', 'Abre GeoSense y vuelve a pulsar <b>Pasar mi progreso a GeoTells</b>, o busca tu código en GeoSense › Ajustes › <b>Código de traspaso</b>.')}
  </section>

  <ol class="steps">
    <li>
      ${t('b', 'Install GeoTells', 'Instala GeoTells')}
      <a class="install" href="${apk}">${android}${t('span', 'Download for Android', 'Descargar para Android')}</a>
      <p class="more">${t('a', 'How to install it', 'Cómo instalarla', 'href="./#install"')}</p>
    </li>
    <li id="open-step" hidden>
      ${t('b', 'Come back here and open it with your code', 'Vuelve aquí y ábrela con tu código')}
      <a class="install secondary" id="open" href="geotells://open">${t('span', 'Open GeoTells', 'Abrir GeoTells')}</a>
    </li>
    <li>
      ${t('b', 'Or type the code in GeoTells', 'O escribe el código en GeoTells')}
      ${t('p', 'On its welcome screen, tap <b>From GeoSense?</b> (or go to Settings) and type or paste the code. Once your progress is there, you can uninstall GeoSense.', 'En su pantalla de bienvenida, pulsa <b>¿Vienes de GeoSense?</b> (o ve a Ajustes) y escribe o pega el código. Cuando tengas ahí tu progreso, ya puedes desinstalar GeoSense.')}
    </li>
  </ol>

  ${t('p', 'The code stays in your browser: it goes after the “#” of the address, which is never sent to this website.', 'El código se queda en tu navegador: va tras el «#» de la dirección, que nunca se envía a este sitio web.', 'class="legal"')}
</main>
<script src="lang.js"></script>
<script src="importar.js"></script>
</body>
</html>
`;
}

fs.writeFileSync('index.html', page({}));
fs.writeFileSync('d.html', page({ invite: 'daily' }));
fs.writeFileSync('w.html', page({ invite: 'word' }));
fs.writeFileSync('privacy.html', privacyPage());
fs.writeFileSync('importar.html', importPage());
