import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('frontend contains required builder surfaces', async () => {
  const html=await readFile(new URL('../public/index.html', import.meta.url),'utf8');
  assert.match(html,/Shortcut Forge/);
  assert.match(html,/id="actionPalette"/);
  assert.match(html,/id="signBtn"/);
});

test('client generator contains supported action identifiers', async () => {
  const js=await readFile(new URL('../public/app.js', import.meta.url),'utf8');
  for (const id of ['is.workflow.actions.gettext','is.workflow.actions.url','is.workflow.actions.openurl','is.workflow.actions.getcurrentlocation','is.workflow.actions.getmapslink','is.workflow.actions.date','is.workflow.actions.setclipboard','is.workflow.actions.showresult','is.workflow.actions.sendemail']) assert.ok(js.includes(id), id);
  assert.ok(js.includes('WFSendEmailActionShowComposeSheet=true'));
});

test('signer uses Apple CLI safely via execFile', async () => {
  const server=await readFile(new URL('../server.mjs', import.meta.url),'utf8');
  assert.match(server,/execFileAsync\('\/usr\/bin\/shortcuts'/);
  assert.match(server,/--mode', 'anyone'/);
  assert.match(server,/plutil/);
});
