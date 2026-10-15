import {AnnaAppRuntime} from '/static/anna-apps/_sdk/latest/index.js';
import {createStore} from './store.mjs';
import {createAi} from './ai.mjs';
import {setLanguage, t} from './i18n.mjs';
import {$, later, notice, renderText} from './view.mjs';
import {mountSettings, refreshModels, renderSettings} from './settings-view.mjs';
import {mountThreads, refreshHistory, renderHistory, renderThread, showView} from './threads-view.mjs';
import {mountCompose, renderPicks} from './compose-view.mjs';

const ctx = {view: 'discussion', threads: [], thread: null, running: null};

function rerender() {
  renderText();
  renderSettings(ctx);
  renderPicks();
  renderHistory(ctx);
  renderThread(ctx);
}

async function main() {
  renderText();
  try {
    const anna = await AnnaAppRuntime.connect();
    ctx.store = createStore(anna.storage);
    ctx.ai = createAi(anna.llm);
    ctx.settings = await ctx.store.loadSettings();
    ctx.rerender = rerender;
    ctx.onSettings = () => refreshModels(ctx);
    setLanguage(ctx.settings.language);
    $('#language').value = ctx.settings.language;
    try {
      ctx.threads = await ctx.store.repairIndex();
    } catch {
      ctx.threads = await ctx.store.listThreads().catch(() => []);
    }
    for (const tab of document.querySelectorAll('#tabs [data-view]')) {
      tab.addEventListener('click', () => {
        showView(ctx, tab.dataset.view);
        if (tab.dataset.view === 'history') later(refreshHistory(ctx));
      });
    }
    mountSettings(ctx);
    mountThreads(ctx);
    mountCompose(ctx);
    rerender();
    showView(ctx, 'discussion');
    anna.window.set_title({title: 'Agent Hub Radio'}).catch(() => {});
    document.body.dataset.ready = 'true';
  } catch {
    notice(t('loadFailed'));
  }
}

main();
