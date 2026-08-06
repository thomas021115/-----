import { createApp, h } from 'vue';
import {
  createRouter,
  createWebHashHistory,
  RouterLink,
  type RouteLocationNormalized
} from 'vue-router';
import type { LobbyPage } from './types';

const pages = [
  { id: 'home', path: '/home', short: '總', label: '行動總覽' },
  { id: 'warzone', path: '/warzone', short: '區', label: '戰區任務' },
  { id: 'loadout', path: '/loadout', short: '整', label: '整備與倉庫' },
  { id: 'shop', path: '/shop', short: '商', label: '物資商城' }
] satisfies readonly LobbyPage[];

const EmptyPage = { render: () => null };
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    ...pages.map((page) => ({ path: page.path, component: EmptyPage, meta: { page: page.id } })),
    { path: '/stash', redirect: '/loadout' },
    { path: '/:pathMatch(.*)*', redirect: '/home' }
  ]
});

function applyLobbyPage(route: RouteLocationNormalized) {
  const activePage = typeof route.meta.page === 'string' ? route.meta.page : 'home';
  document.querySelectorAll<HTMLElement>('[data-lobby-page]').forEach((section) => {
    const active = section.dataset.lobbyPage === activePage;
    section.classList.toggle('lobbyPageHidden', !active);
    section.classList.toggle('lobbyPageActive', active);
    section.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  document.body.dataset.lobbyRoute = activePage;
  const lobby = document.getElementById('lobbyScreen');
  if (lobby) lobby.scrollTop = 0;
}

router.afterEach(applyLobbyPage);

const LobbyNavigation = {
  render() {
    return h('header', { class: 'lobbyNav panel' }, [
      h('div', { class: 'lobbyBrand' }, [
        h('div', { class: 'lobbyBrandMark', 'aria-hidden': 'true' }, '鴨'),
        h('div', { class: 'lobbyBrandCopy' }, [
          h('b', '鴨鎮行動中心'),
          h('span', '離線戰術終端')
        ])
      ]),
      h('nav', { class: 'lobbyTabs', 'aria-label': '大廳功能分頁' }, pages.map((page) =>
        h(RouterLink, {
          to: page.path,
          class: 'lobbyTab',
          activeClass: 'active',
          'data-ui-route': page.id
        }, {
          default: () => [
            h('span', { class: 'lobbyTabIcon', 'aria-hidden': 'true' }, page.short),
            h('span', page.label)
          ]
        })
      )),
      h('div', { class: 'offlineStatus', title: '成品不會連接網路' }, [
        h('i', { 'aria-hidden': 'true' }),
        h('span', 'OFFLINE')
      ])
    ]);
  }
};

const app = createApp(LobbyNavigation);
app.use(router);
app.mount('#lobbyNavApp');

router.isReady().then(() => {
  applyLobbyPage(router.currentRoute.value);
  document.body.classList.add('uiShellReady');
});

window.__duckUi = {
  go(path: string) {
    return router.push(path);
  },
  current() {
    return router.currentRoute.value.path;
  },
  pages: pages.map((page) => page.path)
};
