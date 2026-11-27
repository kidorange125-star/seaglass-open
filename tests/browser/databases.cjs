const { chromium } = require('playwright');
const S = process.argv[2] || require('os').tmpdir();
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push('console: '+m.text()));
  await p.goto((process.env.SEAGLASS_URL || 'http://localhost:5173'));
  await p.click('.sb-head button[title="New database"]'); await p.waitForSelector('.dbtable'); await p.waitForTimeout(700);
  console.log('schema persisted:', (await (await fetch((process.env.SEAGLASS_URL || 'http://localhost:5173') + '/api/search?q=Untitled')).json()).length >= 0);
  await p.fill('.title', 'Tasks'); await p.waitForTimeout(800);
  // add 3 rows
  for (const [t] of [['Write essay'],['Study math'],['Buy milk']]) {
    await p.click('.addrow td'); await p.waitForTimeout(500);
    await p.keyboard.type(t); await p.keyboard.press('Enter');
  }
  await p.waitForTimeout(600);
  console.log('rows in DOM:', await p.locator('tr.dbrow').count());
  // set status on first row via popover
  await p.locator('tr.dbrow').nth(0).locator('td').nth(1).locator('.cell-btn').click();
  await p.waitForSelector('.fixed-pop .opt'); await p.locator('.fixed-pop .opt').nth(2).click(); await p.waitForTimeout(400);
  await p.locator('tr.dbrow').nth(1).locator('td').nth(1).locator('.cell-btn').click(); await p.locator('.fixed-pop .opt').nth(1).click(); await p.waitForTimeout(400);
  // date on row 2
  await p.locator('tr.dbrow').nth(1).locator('td').nth(2).locator('.cell-btn').click();
  await p.locator('.fixed-pop .dp-day:not(.out)').nth(11).click(); // the 12th of this month, from the calendar await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  // multi-select create on row 0
  await p.locator('tr.dbrow').nth(0).locator('td').nth(3).locator('.cell-btn').click();
  await p.fill('.fixed-pop input', 'school'); await p.keyboard.press('Enter'); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.screenshot({ path: S + '/db_table.png' });
  // persisted?
  const id = (await (await fetch((process.env.SEAGLASS_URL || 'http://localhost:5173') + '/api/tree')).json()).find(n=>n.title==='Tasks').id;
  const rows = await (await fetch(`${process.env.SEAGLASS_URL || 'http://localhost:5173'}/api/notes/${id}/children`)).json();
  console.log('server rows:', rows.map(r => r.title + ' ' + r.props));
  // switch to board
  await p.click('.tabs .ghost'); await p.locator('.fixed-pop .opt', { hasText: 'Board' }).click(); await p.waitForSelector('.board'); await p.waitForTimeout(500);
  console.log('board columns:', await p.locator('.board .col').count());
  // drag card from Not started to Done
  const card = p.locator('.bcard', { hasText: 'Buy milk' }); const doneCol = p.locator('.col', { hasText: 'Done' });
  await card.dragTo(doneCol); await p.waitForTimeout(700);
  console.log('Done column cards:', await doneCol.locator('.bcard').allInnerTexts());
  await p.screenshot({ path: S + '/db_board.png' });
  // calendar
  await p.click('.tabs .ghost'); await p.locator('.fixed-pop .opt', { hasText: 'Calendar' }).click(); await p.waitForSelector('.cal-grid');
  await p.click('.cal-nav button >> nth=0'); await p.click('.cal-nav button >> nth=1'); await p.waitForTimeout(300);
  console.log('calendar events visible this month:', await p.locator('.cev').count());
  console.log('errors:', errs.slice(0,6));
  await b.close();
})();
