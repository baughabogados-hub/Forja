const CACHE = 'forja-v5';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './forja-push.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const resClone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, resClone));
      return res;
    }).catch(() => cached))
  );
});

/* ==================================================================
   Avisos
   El servidor solo dice "es la hora". El texto se redacta aquí, en el
   teléfono, leyendo el espejo que forja-push.js deja en IndexedDB.
   Ningún dato de la bitácora sale del dispositivo.
   ================================================================== */

function forjaLeerEstado() {
  return new Promise((ok) => {
    let req;
    try { req = indexedDB.open('forja', 1); } catch (e) { return ok(null); }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('estado')) {
        req.result.createObjectStore('estado');
      }
    };
    req.onerror = () => ok(null);
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('estado', 'readonly');
        const g = tx.objectStore('estado').get('actual');
        g.onsuccess = () => ok(g.result || null);
        g.onerror = () => ok(null);
      } catch (e) { ok(null); }
    };
  });
}

function forjaHoy() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Rota entre variantes según el día del año: varía sin repetirse seguido.
function forjaVariante(lista) {
  const d = new Date();
  const dia = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return lista[dia % lista.length];
}

function forjaRedactar(slot, estado) {
  const nombre = (estado && estado.nombre) || '';
  const racha = (estado && estado.racha) || 0;
  const alDia = !!(estado && estado.ultimoDia === forjaHoy());
  const cerrado = !!(estado && estado.cerrado && alDia);
  const pend = (estado && alDia && estado.pendientes) || [];
  const puntos = (estado && alDia && estado.puntosHoy) || 0;
  const lista = pend.slice(0, 3).join(', ');

  if (slot === 'prueba') {
    return { title: 'Forja', body: 'Aviso de prueba. El canal quedó abierto.' };
  }

  if (cerrado) {
    return {
      title: 'Día cerrado',
      body: racha > 1
        ? forjaVariante([
            racha + ' días seguidos en la Forja.',
            'Asentado. Van ' + racha + ' días.',
            'Constancia de ' + racha + ' días.'
          ])
        : 'Asentado. Mañana seguimos.'
    };
  }

  if (slot === 'manana') {
    if (racha >= 7) {
      return {
        title: 'Racha de ' + racha + ' días',
        body: forjaVariante([
          'Se abre el día. Nada asentado todavía.',
          'La hoja de hoy está en blanco.',
          'Día ' + (racha + 1) + '. Empieza cuando quieras.'
        ])
      };
    }
    return {
      title: nombre ? 'Buen día, ' + nombre : 'Buen día',
      body: forjaVariante([
        'La hoja de hoy está en blanco.',
        'Empieza por lo primero.',
        'El día está por asentarse.'
      ])
    };
  }

  if (slot === 'medio') {
    if (pend.length) {
      return {
        title: 'Corte del mediodía',
        body: puntos > 0
          ? 'Van ' + puntos + ' puntos. Sin marcar: ' + lista + '.'
          : 'Sin marcar: ' + lista + '.'
      };
    }
    return {
      title: 'Corte del mediodía',
      body: forjaVariante([
        'Media jornada por delante.',
        'Buen avance. Sigue.',
        'Vas al corriente.'
      ])
    };
  }

  // Noche
  if (racha >= 21) {
    return {
      title: racha + ' días sin romper',
      body: pend.length
        ? 'Falta cerrar hoy. Pendiente: ' + lista + '.'
        : 'Falta cerrar hoy.'
    };
  }
  if (racha >= 3) {
    return {
      title: 'Llevas ' + racha + ' días',
      body: pend.length
        ? 'Sin registrar: ' + lista + '.'
        : forjaVariante([
            'Cierra el día antes de dormir.',
            'Queda asentar el día.',
            'Falta el sello de hoy.'
          ])
    };
  }
  return {
    title: 'Forja',
    body: pend.length
      ? 'Sin registrar: ' + lista + '.'
      : forjaVariante([
          'El día sigue sin registrarse.',
          'Queda asentar el día.',
          'La hoja de hoy sigue en blanco.'
        ])
  };
}

self.addEventListener('push', (event) => {
  let carga = {};
  try { carga = event.data ? event.data.json() : {}; } catch (e) { carga = {}; }

  event.waitUntil(
    forjaLeerEstado().then((estado) => {
      const t = forjaRedactar(carga.slot || 'noche', estado);
      return self.registration.showNotification(t.title, {
        body: t.body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'forja-recordatorio',
        renotify: true,
        data: { url: self.registration.scope }
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) return c.focus();
      }
      return clients.openWindow(destino);
    })
  );
});
