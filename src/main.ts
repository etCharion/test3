/**
 * Vstupní bod aplikace.
 */

import './styles/app.css';
import { mountApp } from './ui/app';
import { registerServiceWorker } from './pwa';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Chybí kořenový element #app.');
}

mountApp(root);
registerServiceWorker();

// Dvojklik na mobilu zoomuje stránku – u skenování to jen rozbíjí rytmus.
document.addEventListener('dblclick', (event) => event.preventDefault(), { passive: false });
