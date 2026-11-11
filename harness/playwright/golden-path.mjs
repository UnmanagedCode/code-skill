// Visual-verification golden path (npm run harness). Boots the plugin against
// fixture roots and the fake cc (boot.mjs) behind a prefix-stripping proxy, so
// the page runs under /plugins/code-skill/ as in cc, and drives inventory → read-only
// detail → hostile skill → create → edit → disable/enable → delete/restore →
// project write (dirty-tree notice) → usage, then captures the inventory and a
// detail in dark mode standalone (no prefix) and at 390×844 embedded. Writes screenshots/NN-<name>.png. Fails
// on any console error other than the expected standalone 404s, on a
// CSP violation and on any native dialog.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHarness } from './codePlaywright.mjs';
import { bootFixture } from './boot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
// Expected standalone 404s: the two host URLs, and the browser's own favicon probe.
const HOST_URLS = /\/plugin(?:Bridge\.js|Theme\.css)|\/favicon\.ico$/;

const { withPage } = await loadHarness();
await fs.rm(SHOTS, { recursive: true, force: true });
await fs.mkdir(SHOTS, { recursive: true });

const fx = await bootFixture();
const shots = [];
const shot = async (page, name, fullPage = false) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
  shots.push(name);
};

function guard(page) {
  const bad = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Content Security Policy/i.test(text)) { bad.push(`CSP: ${text}`); return; }
    const url = m.location()?.url ?? '';
    if (HOST_URLS.test(url) || HOST_URLS.test(text)) return;
    bad.push(`${text} (${url})`);
  });
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => { bad.push(`native dialog: ${d.type()} ${d.message()}`); d.dismiss(); });
  return bad;
}

const row = (page, id) => page.locator(`tr[data-id="${id}"]`);
const pane = (page) => page.getByRole('complementary', { name: 'Skill details' });
const readJson = async (rel) => JSON.parse(await fs.readFile(fx.roots.p(rel), 'utf8'));
// A successful toggle shows no notice; the switch and the row's state are the feedback.
const assertNoToggleNotice = async (page) => assert.equal(await page.getByText(/ (enabled|disabled)\.$/).count(), 0, 'no toggle success notice');

async function openSkill(page, id) {
  await row(page, id).getByRole('button').first().click();
  await pane(page).getByRole('heading', { level: 2 }).filter({ hasNotText: 'Loading' }).first().waitFor();
}

try {
  await withPage(async (page) => {
    const bad = guard(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(fx.url);
    assert.equal(new URL(page.url()).pathname, '/plugins/code-skill/');

    // 1. Inventory: budget, totals, duplicate and near-duplicate markers.
    await row(page, 'user:~:pdf-tools').waitFor();
    await page.locator('tr[data-total="user:~"]').waitFor();
    assert.equal(await page.locator('tr[data-context]').count(), 2, '200k and 1M budgets (1M also live)');
    assert.match(await row(page, 'project:projA:release-notes').locator('.marker').getAttribute('title'), /shadowed by user skill/);
    assert.match(await row(page, 'user:~:pdf-tools').locator('.marker').getAttribute('title'), /similar to pdf-helper/);
    await page.getByText('Never fired').count();
    await row(page, 'user:~:pdf-tools').locator('td').nth(5).getByText('2').waitFor();
    const mismatch = row(page, 'user:~:renamed-folder');
    await mismatch.getByRole('button', { name: 'old-name' }).waitFor();
    assert.ok(await mismatch.getByRole('switch').isDisabled(), 'name ≠ folder: toggle disabled');
    await shot(page, '01-inventory', true);

    // 2. Read-only cc core skill, opened by clicking its row (not the name): owned-by badge, no editor.
    await row(page, 'cc-core:code-conductor:scripting').locator('td.owner').click();
    await pane(page).getByRole('heading', { name: 'code-conductor:scripting' }).waitFor();
    await pane(page).getByText('Read-only: owned by code-conductor (core)').waitFor();
    await pane(page).getByText('Fixed per session at creation').waitFor();
    assert.ok(new URL(page.url()).pathname.startsWith('/plugins/code-skill/'), 'URL state stays under the prefix');
    // With the pane open the skills table hides columns; every body row must still line up with the header.
    const misaligned = await page.locator('table.skills').evaluate((table) => {
      const lefts = (row) => [...row.cells].filter((c) => c.getClientRects().length).map((c) => Math.round(c.getBoundingClientRect().left));
      const head = lefts(table.tHead.rows[0]);
      return [...table.tBodies[0].rows].filter((r) => lefts(r).join() !== head.join()).map((r) => r.dataset.id);
    });
    assert.deepEqual(misaligned, [], 'skills table rows align with the header');
    assert.equal(await pane(page).getByRole('textbox', { name: 'Frontmatter (YAML)' }).count(), 0);
    const desc = pane(page).locator('.description');
    await desc.getByText('Use when cc tool results need filtering or aggregating before you read them').waitFor();
    assert.ok(await desc.isVisible(), 'description visible in the read-only detail');
    assert.ok((await desc.boundingBox()).y < (await pane(page).locator('.preview').boundingBox()).y, 'description sits above the preview');
    await shot(page, '02-readonly-detail');

    // 2b. Convention skill: sessions listed.
    await openSkill(page, (await page.locator('tr[data-id^="convention:cc-conductor#"]').first().getAttribute('data-id')));
    await pane(page).getByText('Carried by 2 sessions').waitFor();
    await pane(page).getByText('projA · fix flaky test (running)').waitFor();
    await shot(page, '02b-convention-detail');

    // 3. Hostile skill: preview renders text only.
    await openSkill(page, 'user:~:hostile');
    const hostileDesc = pane(page).locator('.description');
    await hostileDesc.getByText('Renders <img src=x onerror=alert(1)> safely').waitFor();
    assert.equal(await hostileDesc.locator('img').count(), 0, 'description is text, not markup');
    await pane(page).getByRole('button', { name: 'Preview' }).click();
    const preview = pane(page).locator('.preview');
    await preview.getByText('This body tries <img src=x onerror=alert(1)>', { exact: false }).waitFor();
    assert.equal(await page.locator('img, script:not([src]), iframe').count(), 0, 'no injected elements');
    assert.equal(await preview.locator('a').count(), 1, 'only the https link');
    assert.equal(await preview.locator('a').getAttribute('href'), 'https://example.com/docs');
    await preview.getByText('[click me](javascript:alert(1))').waitFor();
    await preview.scrollIntoViewIfNeeded();
    await shot(page, '03-hostile-preview');

    // 4. Create a user skill.
    await page.getByRole('button', { name: 'New skill' }).click();
    const name = pane(page).getByRole('textbox', { name: 'Name' });
    await name.fill('Bad Name');
    await pane(page).getByText('Use 1–64 lowercase').waitFor();
    await name.fill('synced');
    await pane(page).getByText('reserved').waitFor();
    await name.fill('commit-msg');
    await pane(page).getByRole('textbox', { name: 'Description' }).fill('Write a conventional commit message for the staged diff');
    await pane(page).getByText(/Listing: ~\d+ tokens/).waitFor();
    await shot(page, '04a-new-skill-form');
    await pane(page).getByRole('button', { name: 'Create' }).click();
    await row(page, 'user:~:commit-msg').waitFor();
    await pane(page).getByRole('textbox', { name: 'Frontmatter (YAML)' }).waitFor();
    await fs.access(fx.roots.p('home/.claude/skills/commit-msg/SKILL.md'));
    await shot(page, '04b-created');

    // 5. Edit its description: the live cost changes, then save.
    const summary = pane(page).locator('.description');
    await summary.getByText('Write a conventional commit message for the staged diff').waitFor();
    await summary.getByText(/Listing: ~\d+ tokens/).waitFor();
    const before = await summary.textContent();
    const fm = pane(page).getByRole('textbox', { name: 'Frontmatter (YAML)' });
    await fm.fill('name: commit-msg\ndescription: Write a conventional commit message for the staged diff, with a scope and a short body explaining why');
    await page.waitForFunction((b) => document.querySelector('.description')?.textContent !== b, before);
    assert.notEqual(await summary.textContent(), before);
    await summary.getByText('with a scope and a short body explaining why').waitFor();
    await pane(page).getByRole('button', { name: 'Save' }).click();
    await pane(page).getByText('Saved.').waitFor();
    assert.match(await fs.readFile(fx.roots.p('home/.claude/skills/commit-msg/SKILL.md'), 'utf8'), /with a scope and a short body/);
    await shot(page, '05-edited');

    // 6. Disable, then re-enable, from the table switch (pane closed: the table shows every column).
    await pane(page).getByRole('button', { name: 'Close' }).click();
    const sw = row(page, 'user:~:commit-msg').getByRole('switch');
    await sw.uncheck();
    await row(page, 'user:~:commit-msg').getByText('not listed').waitFor();
    await assertNoToggleNotice(page);
    assert.equal((await readJson('home/.claude/settings.json')).skillOverrides['commit-msg'], 'off');
    assert.equal((await readJson('home/.claude/settings.json')).model, 'opus', 'other keys kept');
    await shot(page, '06-disabled');
    await row(page, 'user:~:commit-msg').getByRole('switch').check();
    await row(page, 'user:~:commit-msg').getByText('not listed').waitFor({ state: 'detached' });
    await assertNoToggleNotice(page);
    assert.equal(await row(page, 'user:~:commit-msg').getByRole('switch').isChecked(), true);
    assert.equal((await readJson('home/.claude/settings.json')).skillOverrides['commit-msg'], undefined);

    // 6b. A claude.ai-synced skill gets the same switch: its namespaced key goes to user settings.
    const syncedId = 'synced:~:skill-creator';
    const syncedKey = 'anthropic-skills:skill-creator';
    await row(page, syncedId).getByRole('switch').uncheck();
    await row(page, syncedId).getByText('not listed').waitFor();
    await assertNoToggleNotice(page);
    const afterOff = await readJson('home/.claude/settings.json');
    assert.equal(afterOff.skillOverrides[syncedKey], 'off');
    assert.equal(afterOff.model, 'opus', 'other keys kept');
    await shot(page, '06b-synced-disabled', true);
    await openSkill(page, syncedId);
    await pane(page).getByRole('button', { name: 'Enable' }).waitFor();
    assert.equal(await pane(page).getByRole('textbox', { name: 'Frontmatter (YAML)' }).count(), 0, 'synced content is not editable');
    await shot(page, '06c-synced-pane');
    await pane(page).getByRole('button', { name: 'Enable' }).click();
    await pane(page).getByRole('button', { name: 'Disable' }).waitFor();
    await assertNoToggleNotice(page);
    assert.equal((await readJson('home/.claude/settings.json')).skillOverrides[syncedKey], undefined);
    await pane(page).getByRole('button', { name: 'Close' }).click();

    // 7. Delete via the in-page dialog, then restore from Trash.
    await openSkill(page, 'user:~:commit-msg');
    await pane(page).getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete commit-msg?' });
    await dialog.waitFor();
    await shot(page, '07a-delete-confirm');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await page.getByText('commit-msg moved to the trash.').waitFor();
    await row(page, 'user:~:commit-msg').waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: 'Trash' }).click();
    await page.locator('tr[data-trash]').first().waitFor();
    await shot(page, '07b-trash');
    await page.locator('tr[data-trash]').first().getByRole('button', { name: 'Restore' }).click();
    await page.getByText('Restored commit-msg.').waitFor();
    await fs.access(fx.roots.p('home/.claude/skills/commit-msg/SKILL.md'));
    await page.getByText('The trash is empty.').waitFor();

    // 8. Project write: the main checkout is now dirty → notice.
    await page.getByRole('tab', { name: 'Inventory' }).click();
    await page.getByRole('button', { name: 'New skill' }).click();
    await pane(page).getByRole('combobox', { name: 'Where' }).selectOption('project:projA');
    await pane(page).getByRole('textbox', { name: 'Name' }).fill('db-migrations');
    await pane(page).getByRole('textbox', { name: 'Description' }).fill('Write reversible database migrations');
    await pane(page).getByRole('button', { name: 'Create' }).click();
    await page.getByText(/projA's main checkout now has an uncommitted change \(\.claude\/skills\/db-migrations, untracked\): commit it, or cc merges into this project will be refused/).waitFor();
    await shot(page, '08-project-dirty-notice');

    // 9. Usage tab.
    await page.getByRole('tab', { name: 'Usage' }).click();
    await page.locator('tr[data-usage="pdf-tools"]').waitFor();
    await page.getByRole('region', { name: 'Never fired' }).getByRole('button', { name: 'release-notes' }).first().waitFor();
    await page.getByRole('region', { name: 'Invoked but no longer installed' }).getByText('retired-skill').waitFor();
    await shot(page, '09-usage', true);

    assert.deepEqual(bad, []);
  }, { headless: true, viewport: DESKTOP });

  // Dark desktop, and light/dark mobile: inventory and a detail.
  for (const [label, viewport, scheme, url] of [['dark', DESKTOP, 'dark', fx.standaloneUrl], ['mobile-light', MOBILE, 'light', fx.url], ['mobile-dark', MOBILE, 'dark', fx.url]]) {
    await withPage(async (page) => {
      const bad = guard(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      await row(page, 'user:~:pdf-tools').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), scheme === 'dark');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no page-level horizontal overflow');
      await shot(page, `10-${label}-inventory`);
      await openSkill(page, 'user:~:pdf-helper');
      await pane(page).locator('.description').getByText('when the user works with PDF files').waitFor();
      await shot(page, `11-${label}-detail`);
      assert.deepEqual(bad, []);
    }, { headless: true, viewport });
  }
  console.log(`golden path OK: ${shots.length} screenshots in ${path.relative(process.cwd(), SHOTS)}/`);
  for (const s of shots) console.log(`  ${s}.png`);
} finally {
  await fx.close();
}
