import {AnnaAppRuntime} from '/static/anna-apps/_sdk/latest/index.js';
import {createStore} from './store.mjs';
import {createAi} from './ai.mjs';
import {setLanguage, t} from './i18n.mjs';
import {$, notice, renderText} from './view.mjs';
import {allChannels} from './context.mjs';
import {mountSettings, refreshModels, renderSettings} from './settings-view.mjs';
import {mountShell, renderHeader, renderSidebar, selectChannel} from './shell-view.mjs';
import {renderTimeline} from './timeline-view.mjs';
import {mountComposer, renderComposer} from './composer-view.mjs';
import {mountBallot} from './ballot-view.mjs';

const ctx = {threads: [], channels: [], channel: null, timeline: [], picks: [], running: null};

function render() {
  renderSidebar(ctx);
  renderHeader(ctx);
  renderComposer(ctx);
  renderTimeline(ctx);
}

function rerender() {
  renderText();
  renderSettings(ctx);
  render();
}

async function main() {
  renderText();
  try {
    const anna = await AnnaAppRuntime.connect();
    ctx.store = createStore(anna.storage);
    ctx.ai = createAi(anna.llm);
    ctx.settings = await ctx.store.loadSettings();
    ctx.render = render;
    ctx.rerender = rerender;
    ctx.onSettings = () => refreshModels(ctx);
    setLanguage(ctx.settings.language);
    $('#language').value = ctx.settings.language;
    try {
      ctx.threads = await ctx.store.repairIndex();
    } catch {
      ctx.threads = await ctx.store.listThreads().catch(() => []);
    }
    ctx.channels = await ctx.store.listChannels().catch(() => []);
    mountSettings(ctx);
    mountShell(ctx);
    mountComposer(ctx);
    mountBallot(ctx);
    renderText();
    renderSettings(ctx);
    const first = allChannels(ctx).find(channel => !channel.archived);
    if (first) await selectChannel(ctx, first.id);
    else render();
    anna.window.set_title({title: 'Agent Hub Radio'}).catch(() => {});
    document.body.dataset.ready = 'true';
  } catch {
    notice(t('loadFailed'));
  }
}

main();
