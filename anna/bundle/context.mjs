import {t} from './i18n.mjs';
import {channelList} from './channels.mjs';

export const allChannels = ctx => channelList(ctx.channels || [], ctx.threads || [], t('legacyChannel'));

export const currentChannel = ctx => allChannels(ctx).find(channel => channel.id === ctx.channel) || null;

export function channelRecord(channel, change = {}) {
  const {count, latest, ...base} = channel;
  return {...base, ...change};
}
