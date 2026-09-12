/* ==================================================================
   Forja · avisos
   Autocontenido: se cuelga solo de la app, no requiere cambios en
   index.html más allá de cargar este archivo.
   Servidor: Railway. Los datos de hábitos NUNCA salen del teléfono;
   lo único que se espeja a IndexedDB es lo que el service worker
   necesita para redactar el aviso.
   ================================================================== */
(function () {
  'use strict';

  var SERVIDOR = 'https://diplomatic-caring-production-d61b.up.railway.app';
  var HORARIOS = '07:30,15:00,22:30';
  var UMBRAL_CERRADO = 0.7; // mismo umbral que el anillo dorado de la bitácora

  /* ---------------- utilidades ---------------- */

  function hoyKey() {
    var d = new Date();
    return (
      d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function keyDesfase(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return (
      d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function leerIndice() {
    try {
      var raw = localStorage.getItem('forja:index');
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function nombre() {
    try {
      return localStorage.getItem('forja:name') || null;
    } catch (e) {
      return null;
    }
  }

  /* ---------------- lectura del estado real ---------------- */

  // Puntos de hoy y meta: se leen del encabezado que la app ya pinta ("35 / 90").
  function puntos() {
    var el = document.getElementById('todayPoints');
    if (!el) return { hoy: 0, meta: 0 };
    var m = (el.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return { hoy: 0, meta: 0 };
    return { hoy: parseInt(m[1], 10), meta: parseInt(m[2], 10) };
  }

  // Pendientes: las filas de "Actuaciones del día" que aún no están selladas.
  function pendientes() {
    var lista = [];
    var filas = document.querySelectorAll('#habits .habit');
    for (var i = 0; i < filas.length; i++) {
      if (!filas[i].classList.contains('done')) {
        var n = filas[i].querySelector('.habit-name');
        if (n) lista.push(n.textContent.trim());
      }
    }
    return lista;
  }

  // Racha: días consecutivos con algo asentado. Si hoy todavía va en cero,
  // la racha se mide desde ayer, para no borrarla a las 00:01.
  function racha() {
    var idx = leerIndice();
    var p = puntos();
    var inicio = p.hoy > 0 ? 0 : 1;
    var cuenta = 0;
    for (var i = inicio; i < 400; i++) {
      var k = keyDesfase(i);
      var pts = i === 0 ? p.hoy : (idx[k] || 0);
      if (pts > 0) cuenta++;
      else break;
    }
    return cuenta;
  }

  function estadoActual() {
    var p = puntos();
    var cerrado = p.meta > 0 && p.hoy >= p.meta * UMBRAL_CERRADO;
    return {
      racha: racha(),
      ultimoDia: hoyKey(),
      cerrado: cerrado,
      pendientes: pendientes(),
      puntosHoy: p.hoy,
      puntosMeta: p.meta,
      nombre: nombre(),
      actualizado: new Date().toISOString()
    };
  }

  /* ---------------- espejo a IndexedDB ---------------- */

  function abrirDB() {
    return new Promise(function (ok, mal) {
      var req = indexedDB.open('forja', 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('estado')) {
          req.result.createObjectStore('estado');
        }
      };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { mal(req.error); };
    });
  }

  var ultimoEspejo = '';

  function espejear() {
    var estado = estadoActual();
    var huella = JSON.stringify([
      estado.racha, estado.cerrado, estado.puntosHoy, estado.pendientes.join('|')
    ]);
    if (huella === ultimoEspejo) return Promise.resolve(false);
    ultimoEspejo = huella;

    return abrirDB().then(function (db) {
      return new Promise(function (ok, mal) {
        var tx = db.transaction('estado', 'readwrite');
        tx.objectStore('estado').put(estado, 'actual');
        tx.oncomplete = function () { ok(true); };
        tx.onerror = function () { mal(tx.error); };
      });
    }).catch(function () { return false; });
  }

  /* ---------------- suscripción ---------------- */

  function b64aUint8(base64) {
    var pad = '='.repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function soportado() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function instalada() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function activar() {
    if (!soportado()) return Promise.reject(new Error('Este navegador no admite avisos.'));
    if (esIOS() && !instalada()) {
      return Promise.reject(new Error('En iPhone: instala Forja en la pantalla de inicio desde Safari y ábrela desde ahí.'));
    }
    return Notification.requestPermission()
      .then(function (permiso) {
        if (permiso !== 'granted') throw new Error('Permiso denegado. Actívalo en los ajustes del sitio.');
        return navigator.serviceWorker.ready;
      })
      .then(function (reg) {
        return fetch(SERVIDOR + '/llave-publica')
          .then(function (r) { return r.text(); })
          .then(function (llave) {
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: b64aUint8(llave.trim())
            });
          });
      })
      .then(function (sub) {
        return fetch(SERVIDOR + '/suscribir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            nombre: nombre(),
            zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
            horarios: HORARIOS
          })
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error('El servidor rechazó la suscripción.');
        return espejear();
      })
      .then(function () { return true; });
  }

  function desactivar() {
    return navigator.serviceWorker.ready
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) {
        if (!sub) return true;
        return fetch(SERVIDOR + '/cancelar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        }).catch(function () {}).then(function () { return sub.unsubscribe(); });
      });
  }

  function estaActivo() {
    if (!soportado()) return Promise.resolve(false);
    return navigator.serviceWorker.ready
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) { return !!sub && Notification.permission === 'granted'; })
      .catch(function () { return false; });
  }

  function probar() {
    return navigator.serviceWorker.ready
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) {
        if (!sub) throw new Error('Primero activa los avisos.');
        return fetch(SERVIDOR + '/probar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
      });
  }

  /* ---------------- interfaz ---------------- */

  var CSS =
    '.forja-avisos{margin:0 0 24px;padding:13px 14px;background:var(--navy-2);' +
    'border:1px solid var(--navy-3);border-radius:9px;}' +
    '.forja-avisos__fila{display:flex;align-items:center;gap:12px;}' +
    '.forja-avisos__info{flex:1;min-width:0;}' +
    '.forja-avisos__t{font-size:14.5px;font-weight:500;color:var(--text);}' +
    '.forja-avisos__s{font-family:"JetBrains Mono",monospace;font-size:10.5px;' +
    'color:var(--muted);margin-top:2px;line-height:1.45;}' +
    '.forja-avisos__b{flex-shrink:0;border:1px solid var(--navy-3);background:var(--navy);' +
    'color:var(--parchment);font-family:"Inter",sans-serif;font-size:12.5px;font-weight:600;' +
    'padding:8px 14px;border-radius:7px;cursor:pointer;}' +
    '.forja-avisos__b[data-activo="1"]{background:var(--gold);color:var(--navy);border-color:var(--gold);}' +
    '.forja-avisos__b:disabled{opacity:.5;}' +
    '.forja-avisos.on{border-color:var(--gold);}';

  function montar() {
    if (document.querySelector('.forja-avisos')) return;
    var vista = document.getElementById('viewToday');
    var bitacora = vista ? vista.querySelector('.bitacora') : null;
    if (!vista) return;

    var estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.appendChild(estilo);

    var caja = document.createElement('div');
    caja.className = 'forja-avisos';
    caja.innerHTML =
      '<div class="forja-avisos__fila">' +
      '<div class="forja-avisos__info">' +
      '<div class="forja-avisos__t">Avisos</div>' +
      '<div class="forja-avisos__s" id="forjaAvisosNota">07:30 · 15:00 · 22:30</div>' +
      '</div>' +
      '<button class="forja-avisos__b" id="forjaAvisosBtn">Activar</button>' +
      '</div>';

    if (bitacora) vista.insertBefore(caja, bitacora);
    else vista.appendChild(caja);

    var boton = document.getElementById('forjaAvisosBtn');
    var nota = document.getElementById('forjaAvisosNota');

    function pinta(activo) {
      boton.textContent = activo ? 'Desactivar' : 'Activar';
      boton.dataset.activo = activo ? '1' : '0';
      caja.classList.toggle('on', !!activo);
      nota.textContent = activo
        ? 'activos · 07:30 · 15:00 · 22:30'
        : '07:30 · 15:00 · 22:30';
    }

    boton.addEventListener('click', function () {
      var activo = boton.dataset.activo === '1';
      boton.disabled = true;
      nota.textContent = activo ? 'desactivando…' : 'activando…';
      (activo ? desactivar() : activar())
        .then(function () { pinta(!activo); })
        .catch(function (e) { nota.textContent = e.message; pinta(activo); })
        .then(function () { boton.disabled = false; });
    });

    if (!soportado()) {
      boton.disabled = true;
      nota.textContent = 'este navegador no los admite';
      return;
    }
    estaActivo().then(pinta);
  }

  /* ---------------- arranque ---------------- */

  function arrancar() {
    montar();
    espejear();
    // Vuelve a espejear cuando el usuario toca algo o regresa a la app.
    document.addEventListener('click', function () { setTimeout(espejear, 250); }, true);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) espejear();
    });
    setInterval(espejear, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(arrancar, 600); });
  } else {
    setTimeout(arrancar, 600);
  }

  window.ForjaPush = {
    activar: activar,
    desactivar: desactivar,
    estaActivo: estaActivo,
    espejear: espejear,
    probar: probar,
    estado: estadoActual
  };
})();
