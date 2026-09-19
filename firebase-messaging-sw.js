/* global firebase */
// Este archivo debe publicarse en la misma carpeta pública que index.html.
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-messaging.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBliPWrdCDZzlFDIdsI17fyINeW-TsMgr0',
  authDomain: 'schoolog-ee12b.firebaseapp.com',
  databaseURL: 'https://schoolog-ee12b-default-rtdb.firebaseio.com',
  projectId: 'schoolog-ee12b',
  storageBucket: 'schoolog-ee12b.firebasestorage.app',
  messagingSenderId: '11132093202',
  appId: '1:11132093202:web:fe1f1d743eb0fb398529cb'
});

// Cetistapp envía mensajes de datos. Mostrarlos explícitamente evita depender
// del comportamiento automático de Firebase en cada navegador.
const messaging = firebase.messaging();
messaging.setBackgroundMessageHandler((payload) => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || 'Cetistapp', {
    body: data.body || '',
    icon: data.icon || '/Cetistapp/favicon.png',
    badge: data.badge || '/Cetistapp/favicon.png',
    tag: data.tag || `cetistapp-${Date.now()}`,
    ...(data.silent === 'true' ? { silent: true } : {}),
    ...(data.color ? { color: data.color } : {}),
    data: { link: data.link || 'https://cetistas.github.io/Cetistapp/' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.link || 'https://cetistas.github.io/Cetistapp/'));
});
