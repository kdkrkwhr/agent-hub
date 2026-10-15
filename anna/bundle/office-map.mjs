import {ROLE_IDS} from './roles.mjs';

export const WIDTH = 1000;
export const HEIGHT = 640;

const room = (id, x, y, w, h, side) => ({id, x, y, w, h, door: {x: x + w / 2, y: side === 'bottom' ? y + h : y}});

export function officeLayout() {
  return {
    corridor: 320,
    rooms: [
      room('research', 30, 30, 300, 250, 'bottom'),
      room('forum', 350, 30, 300, 250, 'bottom'),
      room('synthesis', 670, 30, 300, 250, 'bottom'),
      room('lounge', 30, 360, 460, 250, 'top'),
      room('review', 510, 360, 460, 250, 'top'),
    ],
  };
}

export function voteLayout(options = [], roles = []) {
  const voters = ROLE_IDS.filter(role => roles.includes(role));
  const zones = [...options.map(option => `option-${option.id}`), 'abstain'];
  const gap = 16;
  const width = (940 - gap * (zones.length - 1)) / zones.length;
  return {
    corridor: 305,
    rooms: [
      ...voters.map((role, index) => room(`booth-${role}`, 40 + index * 320, 30, 280, 220, 'bottom')),
      ...zones.map((id, index) => room(id, 30 + index * (width + gap), 360, width, 250, 'top')),
    ],
  };
}

export const findRoom = (layout, id) => layout.rooms.find(item => item.id === id) || null;

export function seat(area, role) {
  const index = Math.max(0, ROLE_IDS.indexOf(role));
  if (area.id.startsWith('booth-')) return {x: area.x + area.w / 2, y: area.y + area.h * 0.62};
  if (area.w < 200) return {x: area.x + area.w / 2, y: area.y + 95 + index * 55};
  return {x: area.x + (area.w * (index + 1)) / 4, y: area.y + area.h * 0.62};
}

export function route(layout, from, to, role) {
  const target = seat(to, role);
  if (!from || from.id === to.id) return [target];
  const y = layout.corridor;
  return [from.door, {x: from.door.x, y}, {x: to.door.x, y}, to.door, target];
}
