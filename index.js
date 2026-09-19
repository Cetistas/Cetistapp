// El Worker necesita ambos permisos: leer/escribir Realtime Database y enviar por FCM.
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/firebase.database'
].join(' ');

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encode(value) {
  return new TextEncoder().encode(value);
}

function pemToArrayBuffer(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s/g, '');
  const binary = atob(body);
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
}

async function createGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64Url(encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: GOOGLE_SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(serviceAccount.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encode(unsignedToken));
  const assertion = `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) throw new Error(`Google OAuth: ${await response.text()}`);
  return (await response.json()).access_token;
}

async function verifyFirebaseUser(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!idToken) return null;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) }
  );
  if (!response.ok) return null;
  const data = await response.json();
  return { uid: data.users?.[0]?.localId, idToken };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://cetistas.github.io' } });
}

function mexicoDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function firebaseRequest(env, accessToken, path, options = {}) {
  const response = await fetch(
    `https://schoolog-ee12b-default-rtdb.firebaseio.com/${path}.json`,
    {
      ...options,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    }
  );
  if (!response.ok) throw new Error(`Realtime Database: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function sendFcmNotification(env, accessToken, token, title, body, tag, silent = false, color = undefined) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        webpush: {
          notification: {
            icon: `${env.APP_URL}favicon.png`,
            badge: `${env.APP_URL}favicon.png`,
            tag,
            renotify: false,
            silent,
            ...(color ? { color } : {})
          },
          fcm_options: { link: env.APP_URL }
        }
      }
    })
  });
  if (!response.ok) throw new Error(`FCM: ${await response.text()}`);
}

function mexicoNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const dias = { Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves', Friday: 'Viernes', Saturday: 'Sábado', Sunday: 'Domingo' };
  return { dia: dias[value.weekday], minutos: Number(value.hour) * 60 + Number(value.minute) };
}

function inicioHorario(user) {
  return user.perfil?.nivel === 'ingenieria' ? 15 * 60 : 7 * 60 + 30;
}

async function enviarAvisosDeHorario(env) {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const accessToken = await createGoogleAccessToken(serviceAccount);
  const users = await firebaseRequest(env, accessToken, 'usuarios') || {};
  const ahora = mexicoNow();
  const fechaRegistro = mexicoDate();
  let enviados = 0;

  for (const [uid, user] of Object.entries(users)) {
    const dispositivos = Object.values(user.dispositivos || {}).filter(device => device?.token);
    if (!dispositivos.length) continue;
    const materias = user.materias_config || {};
    const inicio = inicioHorario(user);

    for (const [claseId, clase] of Object.entries(user.horario || {})) {
      if (clase?.tipo !== 'clase' || clase.dia !== ahora.dia || !Number.isInteger(Number(clase.moduloInicio))) continue;
      const inicioClase = inicio + Number(clase.moduloInicio) * 50;
      const minutosRestantes = inicioClase - ahora.minutos;
      if (minutosRestantes <= 0 || minutosRestantes > 5) continue;

      const avisoPath = `usuarios/${uid}/notificaciones_enviadas/horario/${claseId}/proxima-${fechaRegistro}-${clase.moduloInicio}`;
      const yaEnviado = await firebaseRequest(env, accessToken, avisoPath);
      if (yaEnviado) continue;

      const materia = materias[clase.materiaId] || {};
      const nombreMateria = materia.nombre || 'Materia sin nombre';
      const body = clase.aula?.trim() ? `${nombreMateria}. Salón: ${clase.aula.trim()}.` : nombreMateria;
      for (const dispositivo of dispositivos) {
        try {
          await sendFcmNotification(env, accessToken, dispositivo.token, 'Próxima clase:', body, `horario-${claseId}-${fechaRegistro}`, true, materia.color);
          enviados += 1;
        } catch (error) {
          // Un token viejo no debe impedir que los demás dispositivos reciban el aviso.
          console.error('No se pudo enviar aviso de horario:', error.message);
        }
      }
      await firebaseRequest(env, accessToken, avisoPath, {
        method: 'PUT', body: JSON.stringify({ enviadoEn: new Date().toISOString() })
      });
    }
  }
  return enviados;
}

async function enviarRecordatoriosDeTareas(env) {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const accessToken = await createGoogleAccessToken(serviceAccount);
  const users = await firebaseRequest(env, accessToken, 'usuarios') || {};
  const hoy = mexicoDate();
  const manana = mexicoDate(1);
  let enviados = 0;

  for (const [uid, user] of Object.entries(users)) {
    const tareas = user.pendientes || {};
    const materias = user.materias_config || {};
    const dispositivos = Object.values(user.dispositivos || {}).filter(device => device?.token);
    if (!dispositivos.length) continue;

    for (const [tareaId, tarea] of Object.entries(tareas)) {
      if (tarea?.type !== 'tarea' || !tarea.fecha || (tarea.fecha !== hoy && tarea.fecha !== manana)) continue;

      const esHoy = tarea.fecha === hoy;
      const tipoAviso = esHoy ? 'hoy' : 'un-dia';
      const avisoPath = `usuarios/${uid}/notificaciones_enviadas/tareas/${tareaId}/${tipoAviso}-${hoy}`;
      const yaEnviado = await firebaseRequest(env, accessToken, avisoPath);
      if (yaEnviado) continue;

      const materia = materias[tarea.materiaId] || {};
      const nombreMateria = materia.nombre || 'Materia sin nombre';
      const modalidad = tarea.entregaVirtual ? 'virtual' : 'presencial';
      const tiempo = esHoy ? 'se entrega hoy' : 'se entrega en 1 día';
      const titulo = `${tarea.nombre || 'Sin título'} - ${nombreMateria}`;
      const body = `${tiempo}, de forma: ${modalidad}.`;

      for (const dispositivo of dispositivos) {
        try {
          await sendFcmNotification(env, accessToken, dispositivo.token, titulo, body, `tarea-${tareaId}-${tipoAviso}`, false, materia.color);
          enviados += 1;
        } catch (error) {
          console.error('No se pudo enviar recordatorio de tarea:', error.message);
        }
      }
      await firebaseRequest(env, accessToken, avisoPath, {
        method: 'PUT', body: JSON.stringify({ enviadoEn: new Date().toISOString() })
      });
    }
  }
  return enviados;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'access-control-allow-origin': 'https://cetistas.github.io', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, X-FCM-Token' } });
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/send-test') return json({ error: 'Not found' }, 404);

    const user = await verifyFirebaseUser(request, env);
    if (!user?.uid) return json({ error: 'Unauthorized' }, 401);

    const devicesResponse = await fetch(`https://schoolog-ee12b-default-rtdb.firebaseio.com/usuarios/${user.uid}/dispositivos.json?auth=${encodeURIComponent(user.idToken)}`);
    const devices = devicesResponse.ok ? await devicesResponse.json() : {};
    const tokenSolicitado = request.headers.get('X-FCM-Token');
    const token = tokenSolicitado && Object.values(devices || {}).some(device => device?.token === tokenSolicitado)
      ? tokenSolicitado
      : Object.values(devices || {}).find(device => device?.token)?.token;
    if (!token) return json({ error: 'No device registered' }, 400);

    const accessToken = await createGoogleAccessToken(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON));
    await sendFcmNotification(env, accessToken, token, 'Cetistapp', '¡Las notificaciones con tu favicon ya funcionan!', 'cetistapp-prueba');
    return json({ ok: true });
  },

  async scheduled(event, env, ctx) {
    const trabajos = [enviarAvisosDeHorario(env)];
    if (event.cron === '0 11 * * *') trabajos.push(enviarRecordatoriosDeTareas(env));
    ctx.waitUntil(Promise.all(trabajos));
  }
};
