const { chromium } = require('playwright');
const S = process.argv[2] || require('os').tmpdir();
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push('console: '+m.text()));
  await p.goto((process.env.SEAGLASS_URL || 'http://localhost:5173'));
  // page A (target for mention)
  await p.click('text=New page'); await p.waitForSelector('.title');
  await p.fill('.title', 'Target Page'); await p.waitForSelector('.ProseMirror'); await p.keyboard.press('Enter');
  await p.keyboard.type('hello target'); await p.waitForTimeout(900);
  // page B
  await p.click('.sb-head button[title="New page"]'); await p.waitForTimeout(500);
  await p.fill('.title', 'Main Page'); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(300); await p.keyboard.press('Enter');
  const slash = async (name) => { await p.keyboard.type('/' + name); await p.waitForSelector('.suggest-pop .on'); await p.keyboard.press('Enter'); await p.waitForTimeout(150); };
  await slash('heading 1'); await p.keyboard.type('Big heading'); await p.keyboard.press('Enter');
  await slash('to-do'); await p.keyboard.type('first task'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await slash('callout'); await p.keyboard.type('careful here'); await p.keyboard.press('ArrowDown');
  await slash('toggle'); await p.keyboard.type('toggle title');
  await p.keyboard.press('ArrowDown').catch(()=>{});
  await p.waitForTimeout(200);
  await p.keyboard.press('Control+End');
  await p.keyboard.press('Enter');
  await slash('table');
  await p.keyboard.press('Control+End'); await p.keyboard.press('Enter');
  await slash('2 columns');
  await p.keyboard.press('Control+End'); await p.keyboard.press('Enter');
  await slash('block equation');
  await p.keyboard.press('Control+End'); await p.keyboard.press('Enter');
  await slash('table of contents');
  await p.keyboard.press('Control+End'); await p.keyboard.press('Enter');
  await p.keyboard.type('see @Target'); await p.waitForSelector('.suggest-pop .on'); await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
  const html = await p.locator('.ProseMirror').innerHTML();
  const has = (s) => html.includes(s);
  console.log({ h1: has('<h1'), task: has('data-type="taskList"'), callout: has('data-type="callout"'), details: has('data-type="details"'), table: has('<table'), columns: has('data-type="columns"'), math: has('block-math') || has('data-latex'), toc: has('data-type="toc"'), mention: has('data-type="mention"') });
  await p.screenshot({ path: S + '/pages1.png' });
  // reload and check round-trip through server sanitizer
  await p.reload(); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(800);
  const html2 = await p.locator('.ProseMirror').innerHTML();
  const has2 = (s) => html2.includes(s);
  console.log('after reload:', { h1: has2('<h1'), task: has2('data-type="taskList"'), callout: has2('data-type="callout"'), details: has2('data-type="details"'), table: has2('<table'), columns: has2('data-type="columns"'), math: has2('data-latex'), toc: has2('data-type="toc"'), mention: has2('data-type="mention"') });
  console.log('errors:', errs.slice(0,6));
  await p.screenshot({ path: S + '/pages2.png' });
  await b.close();
})();
