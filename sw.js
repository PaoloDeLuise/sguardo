// Service worker: dopo la prima apertura con internet, Sguardo parte anche senza rete.
//
// - File di Sguardo (pagina, script, parole): prima la rete, poi la copia salvata. Con internet si
//   usa sempre la versione più recente; senza, l'ultima vista.
// - MediaPipe e modello del viso (vendor/, circa 23 MB): prima la copia. La cartella porta il
//   numero di versione, quindi il contenuto non cambia mai e non si riscarica a ogni avvio.
// - Le API di serve.py (voce, registrazioni) non passano mai da qui.
//
// Qui dentro non c'è nessun dato della persona: solo i file dell'applicazione.

const CACHE = "sguardo-v1";
const NETWORK_TIMEOUT_MS = 3000; // rete lenta o assente: si usa la copia senza far aspettare

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("sguardo-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim(); // vale già per la pagina che lo ha appena registrato
  })());
});

// "own": file di Sguardo; "library": MediaPipe e modello; null: non ci riguarda (altri siti, API).
function kind(url) {
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return null;
  return url.pathname.includes("/vendor/") ? "library" : "own";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const which = kind(new URL(request.url));
  if (which) event.respondWith(which === "own" ? networkFirst(request) : cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  // La pagina si apre anche con ?mouse o altri parametri: la copia è la stessa.
  const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (!cached) return network;
  network.catch(() => {}); // senza rete resta la copia
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  return Promise.race([network, timeout]).then((response) => (response?.ok ? response : cached), () => cached);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// La pagina manda l'elenco dei file che ha caricato prima che il service worker fosse attivo
// (alla prima visita): si conservano anche quelli, senza un elenco da tenere aggiornato a mano.
self.addEventListener("message", (event) => {
  const urls = event.data?.cache;
  if (!Array.isArray(urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const address of urls) {
      try {
        if (!kind(new URL(address)) || await cache.match(address)) continue;
        const response = await fetch(address);
        if (response.ok) await cache.put(address, response);
      } catch {
        // indirizzo non valido o rete assente: si riproverà alla prossima apertura
      }
    }
  })());
});
