import {AnnaAppRuntime} from '/static/anna-apps/_sdk/latest/index.js';

const anna = await AnnaAppRuntime.connect();
await anna.window.set_title({title: 'Agent Hub Radio'});
await anna.storage.get({key: 'settings'});
document.body.dataset.ready = 'true';
