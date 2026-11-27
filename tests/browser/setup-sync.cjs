const { chromium } = require('playwright');
const S = process.argv[2] || require('os').tmpdir(); const B = (process.env.SEAGLASS_URL || 'http://localhost:5173');
const j = (m, path, body) => fetch(B + path, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('sg.agent', '0'));
  await p.goto(B + '/'); await p.waitForSelector('.hero');
  console.log('manifest linked:', await p.locator('link[rel=manifest]').count() === 1, '| manifest + icons served:', (await fetch(B + '/manifest.webmanifest')).status, (await fetch(B + '/icon-512.png')).status, (await fetch(B + '/apple-touch-icon.png')).status);
  await p.click('.sb-foot .rel button'); await p.locator('.settings-pop button', { hasText: 'Setup & status' }).click(); await p.waitForSelector('.su-checks li');
  console.log('setup checks:', (await p.locator('.su-checks li b').allInnerTexts()).join(' | '));
  await p.locator('.su-test button').click(); await p.waitForSelector('.su-test p'); console.log('test connection:', await p.locator('.su-test p').innerText());
  console.log('MCP url shown:', (await p.locator('.su-row code').first().innerText()));
  await p.screenshot({ path: S + '/final_setup.png' });
  await p.locator('.su-head button').click();
  // sync: another "device" edits the open page and adds a page
  const n = await j('POST', '/api/notes', { title: 'Sync test', html: '<p>original</p>' });
  await p.goto(`${B}/#/p/${n.id}`); await p.waitForSelector('.ProseMirror');
  const cur = await j('GET', `/api/notes/${n.id}`);
  await j('PATCH', `/api/notes/${n.id}`, { title: 'Sync test (edited on iPad)', html: '<p>changed on another device</p>', revision: cur.revision });
  await j('POST', '/api/notes', { title: 'Made on my phone' });
  await p.waitForFunction(() => document.querySelector('.ProseMirror')?.innerText.includes('changed on another device'), null, { timeout: 15000 }).catch(() => {});
  console.log('open page updated from another device:', (await p.locator('.ProseMirror').innerText()).includes('changed on another device'), '| title:', await p.inputValue('.title'));
  console.log('new page appeared in sidebar:', await p.locator('.sidebar .name', { hasText: 'Made on my phone' }).count() === 1);
  console.log('errors:', errs.slice(0, 3));
  await b.close();
})();
