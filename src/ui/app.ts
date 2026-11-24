/**
 * Skořápka aplikace: hlavička, spodní navigace a přepínání obrazovek.
 */

import { h } from './dom';
import { icon, type IconName } from './icons';
import { parseHash, goList, goScan, goSearch, goSettings, type Route } from './router';
import { createScanScreen, type Screen } from './screens/scan';
import { createListScreen } from './screens/list';
import { createSearchScreen } from './screens/search';
import { createSettingsScreen } from './screens/settings';
import { createBookScreen } from './screens/book';
import { createNewScreen } from './screens/new';
import { store } from '../app/library';

/** České skloňování počtu knih: 1 kniha, 2–4 knihy, 5+ knih. */
export function pluralBooks(count: number): string {
  if (count === 1) return '1 kniha';
  if (count >= 2 && count <= 4) return `${count} knihy`;
  return `${count} knih`;
}

interface TabDef {
  label: string;
  icon: IconName;
  go: () => void;
}

const TABS: TabDef[] = [
  { label: 'Skenovat', icon: 'scan', go: goScan },
  { label: 'Knihovna', icon: 'books', go: goList },
  { label: 'Hledat', icon: 'search', go: goSearch },
  { label: 'Nastavení', icon: 'settings', go: goSettings },
];

/** Která záložka odpovídá které obrazovce. */
const TAB_FOR_ROUTE: Record<Route['name'], number> = {
  scan: 0,
  new: 0,
  list: 1,
  book: 1,
  search: 2,
  settings: 3,
};

export function mountApp(root: HTMLElement): void {
  const title = h('h1', { class: 'app__title', text: 'Skenovat' });
  const count = h('span', { class: 'app__count' });
  const header = h('header', { class: 'app__header' }, title, count);
  const main = h('main', { class: 'app__main' });
  const tabBar = h('nav', { class: 'tabbar', 'aria-label': 'Hlavní navigace' });

  root.replaceChildren(h('div', { class: 'app' }, header, main, tabBar));

  let current: Screen | null = null;
  let currentHash: string | null = null;

  const tabButtons = TABS.map((tab) => {
    const button = h(
      'button',
      {
        class: 'tab',
        type: 'button',
        'aria-label': tab.label,
        on: { click: () => tab.go() },
      },
      icon(tab.icon),
      h('span', { text: tab.label }),
    );
    tabBar.appendChild(button);
    return button;
  });

  function updateCount(): void {
    const stats = store.stats();
    count.textContent = stats.total === 0 ? 'prázdná knihovna' : pluralBooks(stats.total);
  }

  function buildScreen(route: Route): { screen: Screen; heading: string } {
    switch (route.name) {
      case 'list':
        return { screen: createListScreen(), heading: 'Knihovna' };
      case 'search':
        return { screen: createSearchScreen(route.query), heading: 'Hledat v katalogu' };
      case 'settings':
        return { screen: createSettingsScreen(), heading: 'Nastavení' };
      case 'book':
        return { screen: createBookScreen(route.id), heading: 'Detail knihy' };
      case 'new':
        return { screen: createNewScreen(route.isbn), heading: 'Nová kniha' };
      case 'scan':
      default:
        return { screen: createScanScreen(), heading: 'Skenovat' };
    }
  }

  function render(): void {
    // Překresluje se jen skutečná změna – jinak by foťák při každém
    // hashchange znovu startoval.
    if (currentHash === location.hash) return;
    currentHash = location.hash;

    const route = parseHash(location.hash);
    current?.destroy();
    main.replaceChildren();

    const { screen, heading } = buildScreen(route);
    current = screen;
    title.textContent = heading;
    main.appendChild(screen.element);
    window.scrollTo({ top: 0 });
    updateCount();

    const activeIndex = TAB_FOR_ROUTE[route.name];
    tabButtons.forEach((button, index) => {
      const active = index === activeIndex;
      button.classList.toggle('tab--active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  window.addEventListener('hashchange', render);
  const unsubscribe = store.subscribe(updateCount);
  window.addEventListener('pagehide', () => current?.destroy());

  if (!location.hash) {
    // Nahradit, ne přidat do historie – zpět z první obrazovky nemá kam jít.
    history.replaceState(null, '', '#/scan');
  }
  render();

  void unsubscribe;
}
