/**
 * Registrace service workeru – aplikace má fungovat i po instalaci na plochu
 * a v knihovně bez signálu (katalog offline neodpoví, ale seznam knih
 * a export do Excelu ano).
 */

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // V místním vývoji SW překáží (drží staré soubory) – zapíná se jen v produkci.
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    const url = new URL('./sw.js', location.href);
    navigator.serviceWorker
      .register(url, { scope: './' })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              console.info('Nová verze aplikace je připravená – projeví se po zavření.');
            }
          });
        });
      })
      .catch(() => {
        /* bez service workeru aplikace funguje také, jen ne offline */
      });
  });
}
