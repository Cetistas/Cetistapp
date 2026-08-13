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

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const notification = payload.notification || {};
  const data = payload.data || {};

  return self.registration.showNotification(notification.title || 'Cetistapp', {
    body: notification.body || 'Tienes una novedad pendiente.',
    icon: 'favicon.png',
    badge: 'favicon.png',
    data: { link: data.link || '/Cetistapp/' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.link));
});
