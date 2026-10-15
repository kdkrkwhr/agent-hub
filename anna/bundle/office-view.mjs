import {$, button, node} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {ROLE_IDS, ROLES} from './roles.mjs';
import {pickThreads, voteActors, workActors} from './office-model.mjs';
import {WIDTH, findRoom, officeLayout, route, seat, voteLayout} from './office-map.mjs';
import {currentChannel} from './context.mjs';

const NS = 'http://www.w3.org/2000/svg';
const TAGS = {analyst: 'AN', critic: 'CR', editor: 'ED'};
const SPEED = 320;
const LINE = 16;
const roleName = role => ROLES[role].name[getLanguage()];
const reduced = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const scene = {key: '', layout: null, layer: null, sprites: new Map(), frame: 0, last: 0, card: ''};

function svg(tag, attrs = {}, text = '') {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (text) element.textContent = text;
  return element;
}

const clip = (text, size) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
const statusLabel = actor => t(`office-${actor.status}`, {choice: actor.choice});

function furniture(group, area, kind) {
  const add = (tag, attrs) => group.append(svg(tag, attrs));
  if (kind === 'forum') {
    add('ellipse', {class: 'table', cx: area.x + area.w / 2, cy: area.y + 100, rx: 118, ry: 26});
    return;
  }
  if (kind === 'synthesis') add('rect', {class: 'board', x: area.x + area.w / 2 - 80, y: area.y + 48, width: 160, height: 42, rx: 6});
  if (kind === 'lounge') {
    add('rect', {class: 'sofa', x: area.x + 28, y: area.y + area.h - 52, width: 170, height: 28, rx: 12});
    add('circle', {class: 'plant', cx: area.x + area.w - 36, cy: area.y + 48, r: 16});
    add('circle', {class: 'plant', cx: area.x + area.w - 36, cy: area.y + area.h - 40, r: 13});
    return;
  }
  if (kind === 'booth') {
    add('rect', {class: 'partition', x: area.x + 14, y: area.y + 40, width: 8, height: area.h - 60, rx: 4});
    add('rect', {class: 'partition', x: area.x + area.w - 22, y: area.y + 40, width: 8, height: area.h - 60, rx: 4});
  }
  if (kind === 'zone') return;
  for (const role of kind === 'booth' ? ROLE_IDS.slice(0, 1) : ROLE_IDS) {
    const point = seat(area, role);
    add('rect', {class: 'desk', x: point.x - 30, y: point.y - 66, width: 60, height: 26, rx: 6});
  }
}

function drawArea(parent, area, kind, label, sub) {
  const group = svg('g', {class: `area area-${kind}`, 'data-area': area.id});
  group.append(svg('rect', {class: 'floor', x: area.x, y: area.y, width: area.w, height: area.h, rx: 16}));
  group.append(svg('rect', {class: 'door', x: area.door.x - 30, y: area.door.y - 5, width: 60, height: 10, rx: 5}));
  furniture(group, area, kind);
  group.append(svg('text', {class: 'area-label', x: area.x + 16, y: area.y + 28}, label));
  if (sub) group.append(svg('text', {class: 'area-sub', x: area.x + 16, y: area.y + 50}, sub));
  parent.append(group);
}

function drawScene(room, thread, layout) {
  const base = svg('g', {class: 'scenery'});
  base.append(svg('rect', {class: 'corridor', x: 16, y: layout.corridor - 34, width: 968, height: 68, rx: 20}));
  base.append(svg('text', {class: 'corridor-label', x: 500, y: layout.corridor + 5, 'text-anchor': 'middle'}, room === 'vote' ? 'INDEPENDENT BALLOT' : 'HALLWAY'));
  for (const area of layout.rooms) {
    if (room !== 'vote') {
      const step = {research: 'opinion', forum: 'rebuttal', synthesis: 'final', review: 'review'}[area.id];
      drawArea(base, area, area.id, t(`room-${area.id}`), step ? t(`step-${step}`) : t('room-lounge-sub'));
    } else if (area.id.startsWith('booth-')) {
      drawArea(base, area, 'booth', roleName(area.id.slice(6)), 'PRIVATE');
    } else {
      const option = thread?.options.find(item => `option-${item.id}` === area.id);
      const size = Math.max(4, Math.floor(area.w / 17));
      drawArea(base, area, 'zone', option ? option.id : clip(t('abstainZone'), size), option ? clip(option.text, size) : '');
    }
  }
  return base;
}

function sprite(role) {
  const group = svg('g', {class: `actor role-${role}`, tabindex: 0, role: 'button', 'data-role': role, 'aria-label': roleName(role)});
  group.append(
    svg('ellipse', {class: 'shadow', cx: 0, cy: 26, rx: 20, ry: 6}),
    svg('circle', {class: 'body', r: 22}),
    svg('text', {class: 'initials', 'text-anchor': 'middle', y: 5}, TAGS[role]),
    svg('text', {class: 'actor-name', 'text-anchor': 'middle', y: 47}, roleName(role)),
  );
  const speech = svg('g', {class: 'speech', 'aria-hidden': 'true'});
  speech.append(svg('rect', {rx: 10}), svg('text', {'text-anchor': 'middle'}));
  group.append(speech);
  return {role, group, speech, area: null, pos: {x: 0, y: 0}, path: [], said: null};
}

function position(item) {
  item.group.setAttribute('transform', `translate(${item.pos.x.toFixed(1)} ${item.pos.y.toFixed(1)})`);
}

function speak(item, actor) {
  const raw = actor.speaking ? (actor.text || (actor.status === 'thinking' ? t('office-thinking') : t('writing'))) : '';
  const text = raw.replace(/\s+/g, ' ').trim();
  if (item.said === text) return;
  item.said = text;
  item.speech.classList.toggle('quiet', !text);
  const lines = text ? [text.slice(0, LINE), text.length > LINE ? clip(text.slice(LINE), LINE) : ''].filter(Boolean) : [];
  const width = Math.min(270, Math.max(80, Math.max(...lines.map(line => line.length), 0) * 15 + 28));
  const height = lines.length * 20 + 14;
  const home = seat(item.area, item.role).x;
  const left = home - width / 2;
  const right = home + width / 2;
  const shift = left < 10 ? 10 - left : right > WIDTH - 10 ? WIDTH - 10 - right : 0;
  const [rect, label] = item.speech.children;
  for (const [key, value] of Object.entries({x: shift - width / 2, y: -30 - height, width, height})) rect.setAttribute(key, value);
  label.replaceChildren(...lines.map((line, index) => svg('tspan', {x: shift, y: -30 - height + 22 + index * 20}, line)));
}

function tick(now) {
  const dt = scene.last ? Math.min(0.05, (now - scene.last) / 1000) : 0.016;
  scene.last = now;
  scene.frame = 0;
  let moving = false;
  for (const item of scene.sprites.values()) {
    let budget = SPEED * dt;
    while (budget > 0 && item.path.length) {
      const [target] = item.path;
      const dx = target.x - item.pos.x;
      const dy = target.y - item.pos.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        item.pos = {...target};
        item.path.shift();
        budget -= distance;
      } else {
        item.pos = {x: item.pos.x + (dx / distance) * budget, y: item.pos.y + (dy / distance) * budget};
        budget = 0;
      }
    }
    position(item);
    item.group.classList.toggle('walking', item.path.length > 0);
    if (item.path.length) moving = true;
  }
  if (moving) scene.frame = requestAnimationFrame(tick);
  else scene.last = 0;
}

function animate() {
  if (!scene.frame) scene.frame = requestAnimationFrame(tick);
}

function draw(room, thread, actors) {
  const layout = room === 'vote' ? voteLayout(thread?.options || [], thread?.roles || []) : officeLayout();
  const key = JSON.stringify([room, getLanguage(), layout.rooms.map(area => area.id), thread?.options?.map(option => option.text) || []]);
  const map = $('#office-map');
  if (key !== scene.key) {
    scene.key = key;
    scene.layout = layout;
    scene.sprites.clear();
    scene.layer = svg('g', {class: 'actors'});
    map.replaceChildren(drawScene(room, thread, layout), scene.layer);
  }
  map.setAttribute('aria-label', t(room === 'vote' ? 'voteRoom' : 'workOffice'));
  const present = new Set();
  for (const actor of actors) {
    present.add(actor.role);
    const area = findRoom(scene.layout, actor.zone === 'booth' ? `booth-${actor.role}` : actor.zone) || scene.layout.rooms[0];
    let item = scene.sprites.get(actor.role);
    if (!item) {
      item = sprite(actor.role);
      item.area = area;
      item.pos = seat(area, actor.role);
      position(item);
      scene.layer.append(item.group);
      scene.sprites.set(actor.role, item);
    } else if (item.area.id !== area.id) {
      const path = route(scene.layout, item.area, area, actor.role);
      item.area = area;
      if (reduced()) {
        item.path = [];
        item.pos = path.at(-1);
        position(item);
      } else {
        item.path = path;
        animate();
      }
    }
    item.group.dataset.zone = area.id;
    item.group.dataset.status = actor.status;
    speak(item, actor);
  }
  for (const [role, item] of scene.sprites) {
    if (present.has(role)) continue;
    item.group.remove();
    scene.sprites.delete(role);
  }
}

function renderStatus(actors) {
  $('#office-status').replaceChildren(...actors.map(actor => {
    const chip = node('span', `status-chip role-${actor.role}`);
    chip.dataset.status = actor.status;
    chip.append(node('strong', '', roleName(actor.role)), node('span', '', statusLabel(actor)));
    return chip;
  }));
}

function openInChat(ctx, thread) {
  ctx.view = 'chat';
  renderOffice(ctx);
  const block = [...document.querySelectorAll('#feed .run')].find(item => item.dataset.id === thread.id);
  block?.scrollIntoView({block: 'start'});
}

function renderCard(ctx, thread, actors) {
  const card = $('#office-card');
  const actor = actors.find(item => item.role === ctx.officeSelected);
  for (const item of scene.sprites.values()) {
    item.group.classList.toggle('selected', item.role === actor?.role);
    item.group.setAttribute('aria-pressed', String(item.role === actor?.role));
  }
  const key = actor ? JSON.stringify([thread?.id, actor, getLanguage()]) : '';
  if (key === scene.card) return;
  scene.card = key;
  card.hidden = !actor;
  if (!actor) return card.replaceChildren();
  const head = node('div', 'card-head');
  head.append(node('span', `avatar role-${actor.role}`, TAGS[actor.role]), node('h3', '', roleName(actor.role)));
  const facts = node('dl', 'card-facts');
  const fact = (label, value) => facts.append(node('dt', '', label), node('dd', '', value));
  if (actor.step) fact(t('stepLabel'), t(`step-${actor.step}`));
  fact(t('status'), statusLabel(actor));
  if (actor.model) fact(t('actualModel'), actor.model);
  const text = actor.text ? clip(actor.text.trim(), 300) : t(actor.zone === 'booth' ? 'voteHidden' : 'officeNoText');
  const actions = node('div', 'card-actions');
  if (thread) actions.append(button(t('openInChat'), () => openInChat(ctx, thread), 'primary'));
  actions.append(button(t('close'), () => {
    ctx.officeSelected = null;
    renderOffice(ctx);
  }));
  card.replaceChildren(head, facts, node('p', 'card-text', text), actions);
}

export function renderOffice(ctx) {
  const channel = currentChannel(ctx);
  const view = channel && ctx.view === 'office' ? 'office' : 'chat';
  $('#view-tabs').hidden = !channel;
  for (const tab of document.querySelectorAll('#view-tabs [data-view]')) tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  $('#feed').hidden = view === 'office';
  $('#office').hidden = view !== 'office';
  if (view !== 'office') return;
  const picked = pickThreads(ctx.timeline, ctx.running?.thread);
  const room = ctx.officeRoom || picked.room;
  for (const tab of document.querySelectorAll('#office [data-room-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.roomTab === room));
  const thread = room === 'vote' ? picked.vote : picked.work;
  const actors = room === 'vote' ? voteActors(thread) : workActors(thread, ctx.picks?.length ? ctx.picks : ROLE_IDS);
  $('#office-caption').textContent = thread
    ? `${t(`kind-${thread.kind}`)} · ${thread.title} · ${t(`status-${thread.status}`)}`
    : t(room === 'vote' ? 'noVote' : 'officeIdle');
  draw(room, thread, actors);
  renderStatus(actors);
  renderCard(ctx, thread, actors);
}

export function mountOffice(ctx) {
  ctx.view = 'chat';
  ctx.renderOffice = () => renderOffice(ctx);
  for (const tab of document.querySelectorAll('#view-tabs [data-view]')) {
    tab.addEventListener('click', () => {
      ctx.view = tab.dataset.view;
      renderOffice(ctx);
    });
  }
  for (const tab of document.querySelectorAll('#office [data-room-tab]')) {
    tab.addEventListener('click', () => {
      ctx.officeRoom = tab.dataset.roomTab;
      ctx.officeSelected = null;
      renderOffice(ctx);
    });
  }
  const pick = event => {
    const actor = event.target.closest?.('.actor');
    if (!actor) return;
    event.preventDefault();
    ctx.officeSelected = ctx.officeSelected === actor.dataset.role ? null : actor.dataset.role;
    renderOffice(ctx);
  };
  const map = $('#office-map');
  map.addEventListener('click', pick);
  map.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') pick(event); });
}
