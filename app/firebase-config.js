/* CRM2 :: app/firebase-config.js
   Конфигурация Firebase. Использует Compat-версию для работы без сборщика.
   Инициализируется только если SDK загружен (иначе CRM2 работает локально). */
'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyAztfCVblrmMgJbBdMiCvFSSFGrLZDf1Yo",
  authDomain: "mycrm-1e0aa.firebaseapp.com",
  projectId: "mycrm-1e0aa",
  storageBucket: "mycrm-1e0aa.firebasestorage.app",
  messagingSenderId: "527487112329",
  appId: "1:527487112329:web:df0627639103f0f7ae6258",
  measurementId: "G-VX0B80ZFP5"
};

// Инициализация Firebase (глобальный объект firebase доступен из compat-скриптов)
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
  // console.log('Firebase инициализирован успешно'); // Можно раскомментировать для проверки
} else {
  console.error('Firebase SDK не загружен. Проверьте порядок скриптов в index.html');
}
