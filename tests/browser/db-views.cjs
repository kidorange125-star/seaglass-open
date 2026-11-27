const { chromium } = require('playwright');
const S = process.argv[2] || require('os').tmpdir(); const B = (process.env.SEAGLASS_URL || 'http://localhost:5173');
(async () => {
  const tree = await (await fetch(B + '/api/tree')).json();
  const tasks = tree.find(n => n.title === 'Tasks');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push('console: '+m.text()));
  await p.goto(`${B}/#/p/${tasks.id}`); await p.waitForSelector('.db-toolbar'); await p.waitForTimeout(800);
  const addView = async (label) => { await p.click('.tabs button[title="Add a view"]'); await p.locator('.fixed-pop .opt', { hasText: label }).click(); await p.waitForTimeout(500); };
  await addView('List'); console.log('list rows:', await p.locator('.lrow:not(.add)').count());
  await addView('Gallery'); console.log('gallery cards:', await p.locator('.gcard:not(.add)').count());
  await addView('Timeline'); console.log('timeline bars:', await p.locator('.tl-bar').count(), 'no-date items:', await p.locator('.nodate .cev').count());
  await p.screenshot({ path: S + '/db_timeline.png' });
  console.log('tabs:', await p.locator('.tabs .tab').allInnerTexts());
  // group the table by status
  await p.locator('.tabs .tab', { hasText: 'Table' }).click(); await p.waitForTimeout(300);
  await p.click('button:has-text("Group")'); await p.locator('.fixed-pop select').selectOption({ label: 'Status' }); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  console.log('group headers:', (await p.locator('tr.grp').allInnerTexts()).map(s => s.replace(/\s+/g, ' ')).join(' | '));
  // template flow
  await p.click('.split button[title="New from template"]'); await p.locator('.fixed-pop .opt', { hasText: 'New template' }).click(); await p.waitForSelector('.row-props'); await p.waitForTimeout(600);
  await p.fill('.title', 'Homework template'); await p.waitForSelector('.ProseMirror'); await p.keyboard.press('Enter'); await p.keyboard.type('Steps: read, practice, review'); await p.waitForTimeout(1000);
  await p.goBack(); await p.waitForSelector('.db-toolbar'); await p.waitForTimeout(600);
  console.log('template hidden from rows:', await p.locator('tr.dbrow').count() + ' rows (expect 3)');
  await p.click('.split button[title="New from template"]'); await p.locator('.fixed-pop .opt', { hasText: 'Homework template' }).click(); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(900);
  console.log('new row from template body:', (await p.locator('.ProseMirror').innerText()).trim(), '| title:', await p.inputValue('.title'));
  console.log('sidebar shows db rows/templates as pages?', (await p.locator('.sidebar .name').allInnerTexts()).filter(t => /Homework|Write essay/.test(t)).length === 0 ? 'no (correct)' : 'YES (bug)');
  console.log('errors:', errs.slice(0, 6));
  await b.close();
})();
