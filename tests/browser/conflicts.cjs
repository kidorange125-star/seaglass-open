const { chromium } = require('playwright');
const B = (process.env.SEAGLASS_URL || 'http://localhost:5173');
(async () => {
  const j = async (m, path, body) => (await fetch(B + path, { method: m, headers: {'content-type':'application/json'}, body: body ? JSON.stringify(body) : undefined })).json();
  const n = await j('POST', '/api/notes', { title: 'Conflict test', html: '<p>start</p>' });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const codes = []; p.on('response', r => { if (r.request().method() === 'PATCH' && r.url().includes('/api/notes/' + n.id)) codes.push(r.status()); });
  await p.goto(`${B}/#/p/${n.id}`); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(600);
  // 1) the app itself patches the open page from the sidebar (favorite via row menu), then I keep typing
  await p.locator('.sidebar .sb-private .row', { hasText: 'Conflict test' }).hover(); await p.locator('.sidebar .sb-private .row', { hasText: 'Conflict test' }).locator('button[title="More"]').click({ force: true });
  await p.locator('.row-menu button', { hasText: 'Add to favorites' }).click(); await p.waitForTimeout(500);
  await p.click('.ProseMirror'); await p.keyboard.press('Control+End'); await p.keyboard.type(' typed after sidebar patch'); await p.waitForTimeout(1500);
  console.log('PATCH statuses after sidebar favorite + typing:', codes, '| banner shown:', await p.locator('.banner').count());
  console.log('saved on server:', (await j('GET', '/api/notes/' + n.id)).html);
  // 2) a REAL external change (e.g. the agent) must still raise the conflict banner
  const cur = await j('GET', '/api/notes/' + n.id);
  await j('PATCH', '/api/notes/' + n.id, { html: '<p>agent rewrote this</p>', revision: cur.revision });
  await p.keyboard.type(' more'); await p.waitForTimeout(1500);
  console.log('after external edit -> banner shown:', await p.locator('.banner').count(), '| statuses:', codes.slice(-2));
  await p.locator('.banner button', { hasText: 'Load latest' }).click(); await p.waitForTimeout(700);
  console.log('after Load latest:', (await p.locator('.ProseMirror').innerText()).trim(), '| banner:', await p.locator('.banner').count());
  await b.close();
})();
