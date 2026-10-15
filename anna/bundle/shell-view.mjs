import {$, button, download, node, notice} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {channelThreads, cleanTitle, createChannel} from './channels.mjs';
import {channelExportName, channelMarkdown} from './export.mjs';
import {newId} from './runner.mjs';
import {allChannels, channelRecord, currentChannel} from './context.mjs';
import {loadTimeline} from './timeline-view.mjs';

const closeDrawer = () => document.body.classList.remove('drawer-open');

export function renderSidebar(ctx) {
  const showClosed = $('#show-closed').checked;
  const list = allChannels(ctx).filter(channel => showClosed || !channel.archived || channel.id === ctx.channel);
  $('#channel-count').textContent = String(list.length);
  $('#channel-list').replaceChildren(...list.map(channel => {
    const item = button('', () => selectChannel(ctx, channel.id), 'channel');
    item.dataset.id = channel.id;
    item.classList.toggle('active', channel.id === ctx.channel);
    item.classList.toggle('closed', channel.archived);
    item.setAttribute('aria-current', String(channel.id === ctx.channel));
    const title = node('strong', '', channel.title);
    const meta = node('small', '', t('channelCount', {n: channel.count}));
    if (channel.archived) meta.append(node('span', 'closed-tag', ` · ${t('closedTag')}`));
    item.append(title, meta);
    return item;
  }));
}

export function renderHeader(ctx) {
  const channel = currentChannel(ctx);
  $('#channel-title').textContent = channel ? channel.title : 'Agent Hub Radio';
  $('#rename').disabled = !channel;
  $('#close-channel').disabled = !channel || ctx.running?.thread.channel === channel.id;
  $('#close-channel').textContent = channel?.archived ? t('reopenChannel') : t('closeChannel');
  $('#export').disabled = !channel?.count;
}

export async function selectChannel(ctx, id) {
  closeDrawer();
  if (ctx.channel !== id) {
    ctx.channel = id;
    ctx.timeline = [];
    ctx.picks = [...(currentChannel(ctx)?.roles || [])];
    ctx.officeRoom = null;
    ctx.officeSelected = null;
    $('#export-text').hidden = true;
  }
  ctx.render();
  await loadTimeline(ctx);
}

export async function newChannel(ctx) {
  const channel = createChannel({id: newId(), title: t('defaultChannel', {n: allChannels(ctx).length + 1})});
  try {
    ctx.channels = await ctx.store.saveChannel(channel);
  } catch {
    return notice(t('saveFailed'));
  }
  await selectChannel(ctx, channel.id);
  $('#composer').elements.request.focus();
}

async function updateChannel(ctx, change) {
  const channel = currentChannel(ctx);
  if (!channel) return false;
  try {
    ctx.channels = await ctx.store.saveChannel(channelRecord(channel, {...change, updated: Date.now()}));
  } catch {
    notice(t('saveFailed'));
    return false;
  }
  ctx.render();
  return true;
}

async function exportChannel(ctx) {
  const channel = currentChannel(ctx);
  if (!channel) return;
  const items = channelThreads(ctx.threads, channel.id, Infinity);
  const threads = (await Promise.all(items.map(item => ctx.store.loadThread(item.id).catch(() => null)))).filter(Boolean);
  download(channelMarkdown(channel, threads, getLanguage()), channelExportName(channel));
}

export function mountShell(ctx) {
  ctx.newChannel = () => newChannel(ctx);
  $('#new-channel').addEventListener('click', () => newChannel(ctx));
  $('#new-channel').disabled = false;
  $('#show-closed').addEventListener('change', () => renderSidebar(ctx));
  $('#menu').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
  $('#scrim').addEventListener('click', closeDrawer);
  $('#close-channel').addEventListener('click', () => {
    const channel = currentChannel(ctx);
    if (channel) updateChannel(ctx, {archived: !channel.archived});
  });
  $('#export').addEventListener('click', () => exportChannel(ctx).catch(() => notice(t('openFailed'))));
  const rename = $('#rename-dialog');
  const form = $('#rename-form');
  $('#rename').addEventListener('click', () => {
    const channel = currentChannel(ctx);
    if (!channel) return;
    form.elements.title.value = channel.title;
    rename.showModal();
    form.elements.title.select();
  });
  $('#rename-cancel').addEventListener('click', () => rename.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const title = cleanTitle(form.elements.title.value);
    if (!title) return notice(t('needText'));
    if (await updateChannel(ctx, {title})) rename.close();
  });
}
