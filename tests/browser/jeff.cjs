const { chromium } = require('playwright');
const S = process.argv[2] || require('os').tmpdir(); const B = (process.env.SEAGLASS_URL || 'http://localhost:5173');
(async () => {
  const j = (m, path, body) => fetch(B + path, { method: m, headers: {'content-type':'application/json'}, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
  const page = await j('POST', '/api/notes', { title: 'Biology notes', icon: '🧬', html: '<h2>Cells</h2><p>The mitochondria is the powerhouse of the cell.</p>' });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1.5 });
  const netlog = []; const errs = []; p.on('response', r => { const u = r.url().replace((process.env.SEAGLASS_URL || 'http://localhost:5173'),''); if (r.status() >= 400) netlog.push(r.status() + ' ' + r.request().method() + ' ' + u.slice(0,60)); }); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto(`${B}/#/p/${page.id}`); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(700);
  await p.keyboard.press('Control+j'); await p.waitForSelector('.agent'); await p.waitForTimeout(500);
  console.log('panel open, model:', await p.locator('.ag-modelbtn').innerText(), '| quick actions:', (await p.locator('.ag-quick button').allInnerTexts()).join(', '));
  await p.screenshot({ path: S + '/agent_empty.png' });
  // send a prompt that creates a page
  await p.fill('.ag-box textarea', 'mock:create Mitosis cheat sheet'); await p.keyboard.press('Enter');
  await p.waitForSelector('.tx-meta', { timeout: 15000 }); await p.waitForTimeout(500);
  console.log('tool cards:', await p.locator('.tx-tool').allInnerTexts());
  console.log('reply text:', (await p.locator('.tx-bubble.them').last().innerText()).trim());
  console.log('footer:', (await p.locator('.tx-meta').last().innerText()).replace(/\s+/g, ' '));
  console.log('new page in sidebar:', await p.locator('.sidebar .name', { hasText: 'Mitosis cheat sheet' }).count());
  await p.screenshot({ path: S + '/agent_run.png' });
  // click the tool card -> opens the page the agent created
  await p.locator('.tx-tool', { hasText: 'Mitosis' }).click(); await p.waitForTimeout(800);
  console.log('tool card opened page:', await p.inputValue('.title'));
  // undo via the message button
  await p.locator('.tx-meta .tx-link', { hasText: 'Undo' }).last().click(); await p.waitForTimeout(900);
  console.log('after Undo button -> page gone from sidebar:', await p.locator('.sidebar .name', { hasText: 'Mitosis cheat sheet' }).count() === 0, '| button now:', (await p.locator('.tx-meta .tx-link').last().innerText()).trim());
  // redo via the same button
  await p.locator('.tx-meta .tx-link', { hasText: 'Redo' }).last().click(); await p.waitForTimeout(900);
  console.log('after Redo -> page back:', await p.locator('.sidebar .name', { hasText: 'Mitosis cheat sheet' }).count());
  // slash commands
  await p.fill('.ag-box textarea', '/'); await p.waitForTimeout(200); console.log('command hints:', await p.locator('.ag-cmds button').allInnerTexts());
  await p.fill('.ag-box textarea', '/undo'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  console.log('/undo ->', (await p.locator('.tx-sys').last().innerText()).trim(), '| page gone:', await p.locator('.sidebar .name', { hasText: 'Mitosis cheat sheet' }).count() === 0);
  await p.fill('.ag-box textarea', '/redo'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  console.log('/redo ->', (await p.locator('.tx-sys').last().innerText()).trim());
  await p.fill('.ag-box textarea', '/undo'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  await p.fill('.ag-box textarea', '/undo'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  console.log('/undo with nothing left ->', (await p.locator('.tx-sys').last().innerText()).trim());
  // edit the page I'm viewing and watch it live-reload in the editor
  await p.goto(`${B}/#/p/${page.id}`); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(600);
  await p.fill('.ag-box textarea', 'mock:edit Biology notes'); await p.keyboard.press('Enter'); await p.waitForSelector('.ag-foot >> nth=1', { timeout: 15000 }).catch(()=>{}); await p.waitForTimeout(1200);
  console.log('editor shows agent edit live:', (await p.locator('.ProseMirror').innerText()).includes('Added by the mock agent'));
  await p.screenshot({ path: S + '/agent_edit.png' });
  // conflict flow: change page after agent run, then undo
  await p.click('.ProseMirror'); await p.keyboard.press('Control+End'); await p.keyboard.type(' my own edit'); await p.waitForTimeout(1200);
  await p.locator('.tx-meta .tx-link', { hasText: 'Undo' }).last().click(); await p.waitForSelector('.modal'); 
  console.log('conflict dialog:', (await p.locator('.modal label').innerText()).slice(0, 90));
  await p.locator('.modal button', { hasText: 'Cancel' }).click(); await p.waitForTimeout(400);
  console.log('my edit survived cancel:', (await p.locator('.ProseMirror').innerText()).includes('my own edit'));
  console.log('failed requests:', netlog);
  await b.close();
})();
