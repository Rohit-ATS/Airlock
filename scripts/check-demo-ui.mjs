/**
 * Click every control the demo script tells somebody to click.
 *
 * `check-console-http.mjs` proves the server behaves as documented. This proves
 * the *interface* does — that the six refusals in DEMO.md §0:20 really are six
 * different refusals when you press the buttons in that order, that the Approve
 * control genuinely stops existing rather than merely greying out, and that the
 * ledger demo breaks its chain in the viewer's own browser.
 *
 * Those are the claims a judge checks by hand in the first ninety seconds, and
 * they were the only load-bearing claims in this repository with no automated
 * check behind them at all — the gate is tested as a function many times over,
 * but "the button is not on the screen" is a statement about the screen.
 *
 * Deliberately NOT part of `npm test`, for the same reason as `check:a11y`: it
 * needs a built console, a running server and a downloaded browser binary, and a
 * test that is flaky for environmental reasons trains people to ignore it. It
 * runs in CI, where all three are guaranteed.
 *
 *   npm run build --workspace @airlock/console
 *   npm start --workspace @airlock/console &
 *   npm run check:demo:ui
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  console.error('This check needs playwright-core and a browser binary:\n');
  console.error('  npm install');
  console.error('  npx playwright-core install chromium\n');
  process.exit(2);
}

const BASE = process.env.AIRLOCK_BASE_URL ?? 'http://localhost:3000';
const launch = process.env.AIRLOCK_CHROMIUM ? { executablePath: process.env.AIRLOCK_CHROMIUM } : {};

let pass = 0;
const failures = [];

function check(condition, label, detail) {
  if (condition) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push({ label, detail });
    console.log(`  FAIL ${label}\n         ${detail}`);
  }
}

/** Press one option inside a labelled radiogroup on the live gate. */
async function setControl(page, group, option) {
  const radio = page
    .locator(`[role="radiogroup"][aria-label="${group}"]`)
    .getByRole('radio', { name: option, exact: true });
  await radio.click();
  // The gate is synchronous, but the readout is React state; let it commit.
  await page.waitForTimeout(60);
}

/** The machine-readable verdict the demo readout prints. */
async function verdict(page) {
  const readout = await page.locator('text=/-> \\{ state: /').first().textContent();
  return readout ?? '';
}

async function main() {
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  // A React error boundary renders as ordinary markup, so a broken page can
  // still be "200 OK with content". Fail on anything the console reports.
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });

  try {
    /* ---------------------------------------------------------------- */
    console.log('\nThe landing page: DEMO.md §0:20, "try to break it, live"');
    /* ---------------------------------------------------------------- */
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // 1. The default: migration, proven, checksums match. Approve exists.
    {
      const approve = page.getByRole('button', { name: /^Approve — apply to production$/ });
      check(await approve.isVisible(), 'the default state offers an Approve control', 'the button was not on the page');
      check((await verdict(page)).includes("state: 'OPEN'"), 'and the readout says OPEN', await verdict(page));
    }

    // 2. Break the checksum triple. The control must not exist at all.
    {
      await setControl(page, 'The checksum triple', 'Line 3 ≠ line 1');
      const approve = page.getByRole('button', { name: /^Approve/ });
      check((await approve.count()) === 0, 'a broken checksum removes the Approve control entirely', `${await approve.count()} approve button(s) still rendered`);
      const v = await verdict(page);
      // Not CERTIFICATE_FAILED: the certificate is present and claims to have
      // passed. AIRLOCK recomputed the triple itself and disagreed, and it says
      // which of the two it is.
      check(v.includes('CHECKSUM_MISMATCH'), 'and seals as CHECKSUM_MISMATCH', v);
      await setControl(page, 'The checksum triple', 'Line 3 ≡ line 1');
    }

    // 3. A stale proof.
    {
      await setControl(page, 'Proof age', '45 min');
      const v = await verdict(page);
      check(v.includes('CERTIFICATE_STALE'), 'a 45-minute-old proof seals as CERTIFICATE_STALE', v);
      await setControl(page, 'Proof age', '2 min');
    }

    // 4. Production moved underneath it.
    {
      await setControl(page, 'Production', 'Moved since');
      const v = await verdict(page);
      check(v.includes('PRODUCTION_DRIFTED'), 'production drift seals as PRODUCTION_DRIFTED', v);
      await setControl(page, 'Production', 'Unchanged');
    }

    // 5. An access grant that never expires — a perfect certificate, refused.
    {
      await setControl(page, 'Change class', 'Access');
      await setControl(page, 'The grant', 'Never expires');
      const v = await verdict(page);
      check(v.includes('GRANT_WITHOUT_EXPIRY'), 'standing access seals as GRANT_WITHOUT_EXPIRY', v);
      await setControl(page, 'The grant', 'Expires in 4 h');
    }

    // 6. You are the person who asked for it.
    {
      await setControl(page, 'You are', 'Who asked for it');
      const v = await verdict(page);
      check(v.includes('SELF_APPROVAL'), 'the requester approving themselves seals as SELF_APPROVAL', v);
      await setControl(page, 'You are', 'An approver');
    }

    // 7. Money over the ceiling — the other documented beat.
    {
      await setControl(page, 'Change class', 'Money');
      await setControl(page, 'Amount', '£41,904.00');
      const v = await verdict(page);
      check(v.includes('POLICY_AMOUNT_CEILING'), '£41,904 over a £25,000 ceiling seals as POLICY_AMOUNT_CEILING', v);
    }

    /*
     * 8. The quorum, both ways round — the pair DEMO.md is easiest to narrate
     *    backwards, so both labels are pinned here.
     *
     *    With no signature held, your press is one of two and the control is a
     *    Countersign. With one already held, your press is the *second*, the
     *    grant goes final, and because an erasure is irreversible the control
     *    becomes a two-step arm instead.
     */
    {
      await setControl(page, 'Change class', 'Erasure');

      await setControl(page, 'Signatures already held', 'None yet');
      const counter = page.getByRole('button', { name: /^Countersign — 0 of 2 signatures$/ });
      check(await counter.isVisible(), 'no signatures held → "Countersign — 0 of 2 signatures"', 'no countersign control');

      await setControl(page, 'Signatures already held', 'One, by someone else');
      const arm = page.getByRole('button', { name: /^This cannot be undone — arm approval$/ });
      check(await arm.isVisible(), 'one signature held → the final press is an armed destroy', 'no arm-approval control');

      // Arming is a deliberate second step, not a confirmation dialog.
      await arm.click();
      await page.waitForTimeout(80);
      const destroy = page.getByRole('button', { name: /^Approve — destroy the listed records$/ });
      check(await destroy.isVisible(), 'and arming reveals the destroy control', 'arming did not change the control');
    }

    // Reset returns the demo to its opening state, which the presenter relies on.
    {
      await page.getByRole('button', { name: 'Reset' }).click();
      await page.waitForTimeout(80);
      const approve = page.getByRole('button', { name: /^Approve — apply to production$/ });
      check(await approve.isVisible(), 'Reset returns the demo to its opening state', 'the Approve control did not come back');
    }

    /* ---------------------------------------------------------------- */
    console.log('\nThe landing page: DEMO.md §1:15, the ledger breaks in your browser');
    /* ---------------------------------------------------------------- */
    {
      const verdictEl = page.locator('text=/LEDGER INTACT|TAMPERING DETECTED/').first();
      await verdictEl.scrollIntoViewIfNeeded();
      check((await verdictEl.textContent())?.includes('LEDGER INTACT'), 'the chain starts intact', await verdictEl.textContent());

      await page.getByRole('button', { name: 'Rewrite it' }).first().click();
      await page.waitForTimeout(900); // the demo animates the re-hash
      const after = await page.locator('text=/LEDGER INTACT|TAMPERING DETECTED/').first().textContent();
      check(after?.includes('TAMPERING DETECTED'), 'rewriting one record breaks the chain', after ?? '(no verdict)');

      await page.getByRole('button', { name: 'Undo' }).first().click();
      await page.waitForTimeout(900);
      const restored = await page.locator('text=/LEDGER INTACT|TAMPERING DETECTED/').first().textContent();
      check(restored?.includes('LEDGER INTACT'), 'and undoing the edit restores it', restored ?? '(no verdict)');
    }

    /* ---------------------------------------------------------------- */
    console.log('\nThe console: the queue, the card and the gate');
    /* ---------------------------------------------------------------- */
    await page.goto(`${BASE}/console`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    /*
     * The standalone caveat has to agree with the server, in both directions.
     *
     * Asserting only "the banner appears when standalone" would let the more
     * damaging bug through: a banner that keeps rendering after a real identity
     * provider is connected trains everybody to ignore it, and then it is not
     * there on the day it matters. So this checks the console says exactly what
     * /api/me says, whichever posture the server under test happens to be in.
     */
    {
      const me = await (await fetch(`${BASE}/api/me`)).json();
      // The whole banner, not the bold half of its first sentence.
      const banner = page.locator('[role="status"]').filter({ hasText: 'Standalone mode' });
      const shown = (await banner.count()) > 0;
      check(
        shown === (me.standalone === true),
        `the standalone banner matches /api/me (standalone=${me.standalone === true})`,
        `api says standalone=${me.standalone === true}, banner ${shown ? 'is' : 'is not'} on screen`,
      );
      if (me.standalone === true) {
        const text = (await banner.first().innerText()) ?? '';
        check(/not\s+separation of duties/i.test(text), 'and says plainly that this is not separation of duties', text.slice(0, 200));
        check(!/dismiss/i.test(text), 'and offers no way to dismiss it', text.slice(0, 200));
      }
    }
    {
      const waiting = page.getByRole('button', { name: /WAITING/ }).first();
      check(await waiting.isVisible(), 'the three zones render, including WAITING', 'no WAITING zone control');
      await waiting.click();
      await page.waitForTimeout(700);

      check(await page.locator('text=APPROVAL QUEUE').first().isVisible(), 'the approval queue renders', 'no APPROVAL QUEUE heading');

      /*
       * Rows are addressed by their request text, not their id: the queue shows
       * a human the change, and the id appears only on the opened card. The
       * left-hand session history quotes similar prose, so `.last()` picks the
       * queue rather than the sidebar.
       */
      const open = async (needle) => {
        const row = page.locator(`text=${needle}`).last();
        await row.scrollIntoViewIfNeeded();
        await row.click();
        await page.waitForTimeout(700);
      };

      // DEMO.md's four cards, each asserted by the control it actually offers.
      await open('drop the deprecated plan_name column');
      check(
        await page.getByRole('button', { name: /^Approve — apply to production$/ }).isVisible(),
        'dos_tier_migration offers "Approve — apply to production"',
        'no approve control',
      );

      await open('was stored in USD instead of EUR');
      {
        const body = (await page.locator('body').innerText()) ?? '';
        check(body.includes('CERTIFICATE_FAILED'), 'dos_currency_fix names its refusal on the card', 'CERTIFICATE_FAILED not shown');
        const approve = page.getByRole('button', { name: /^(Approve|Countersign|This cannot be undone)/ });
        check((await approve.count()) === 0, 'and offers nothing to approve', `${await approve.count()} control(s) rendered`);
      }

      await open('length of this incident');
      check(
        await page.getByRole('button', { name: /^Countersign — 0 of 2 signatures$/ }).isVisible(),
        'dos_access_oncall offers "Countersign — 0 of 2 signatures"',
        'no countersign control',
      );

      await open('Remove them from every system');
      check(
        await page.getByRole('button', { name: /^This cannot be undone — arm approval$/ }).isVisible(),
        'dos_erasure_dana offers the armed destroy, its second signature being yours',
        'no arm-approval control',
      );
    }

    /* ---------------------------------------------------------------- */
    console.log('\nThe control room');
    /* ---------------------------------------------------------------- */
    await page.goto(`${BASE}/control`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    {
      const body = (await page.locator('body').textContent()) ?? '';
      check(body.includes('Posture'), 'the control room renders its posture panel', 'no Posture heading');
      check(/sha256:|Head/i.test(body), 'and reports the ledger head', 'no ledger head on the page');
    }

    /* ---------------------------------------------------------------- */
    console.log('\nAn unreachable harness is reported, not swallowed');
    /* ---------------------------------------------------------------- */
    {
      /*
       * With no harness running, the console's `/harness/*` proxy answers 502.
       * That is the correct answer — it genuinely cannot reach anything — and
       * the interesting question is not whether the request failed but whether
       * the console admits it. "Nothing happened" and "nobody could ask" render
       * identically on every dashboard that does not make the distinction, and
       * on this one they must not.
       */
      const activity = await (await fetch(`${BASE}/api/activity`)).json();
      await page.goto(`${BASE}/console`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);

      const notice = page.locator('text=No agent run can start');
      const shown = (await notice.count()) > 0;
      check(
        shown === (activity.reachable === false),
        `the harness notice matches /api/activity (reachable=${activity.reachable})`,
        `api says reachable=${activity.reachable}, notice ${shown ? 'is' : 'is not'} on screen`,
      );

      if (activity.reachable === false) {
        const body = await page.locator('body').innerText();
        check(/WAITING/.test(body) && /still work/i.test(body), 'and says which half of the console still works', body.slice(0, 400));

        // The trap this fixes: pressing an example used to leave a dead chat
        // with nothing explaining why. The notice must survive the press.
        await page.getByText('Add a column, backfill it, drop the deprecated one').first().click();
        await page.waitForTimeout(2500);
        check(
          (await page.locator('text=No agent run can start').count()) > 0,
          'and the notice is still there after pressing an example prompt',
          'the notice vanished once the transcript opened',
        );
      }
    }

    /* ---------------------------------------------------------------- */
    console.log('\nNothing threw while all that happened');
    /* ---------------------------------------------------------------- */
    {
      /*
       * Ignored deliberately: favicon/manifest noise, React's devtools notice,
       * and the harness proxy's own 502s — the last of which are an expected,
       * handled condition asserted directly above rather than a fault. A React
       * render error or an unhandled rejection is not ignored.
       */
      const expected =
        /favicon|manifest|Download the React DevTools|502 \(Bad Gateway\)|\/harness\/|HARNESS_UNREACHABLE|thread list load failed/i;
      const real = pageErrors.filter((e) => !expected.test(e));
      check(real.length === 0, 'no unexpected page errors on any route', real.slice(0, 5).join('\n         '));
    }
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`Demo UI checks failed — ${failures.length} of ${pass + failures.length}:\n`);
    for (const f of failures) console.error(`  - ${f.label}\n      ${f.detail}`);
    process.exit(1);
  }
  console.log(`The demo's controls check out — ${pass} interactions driven in a real browser.`);
}

main().catch((error) => {
  console.error(`\ncheck-demo-ui failed to run: ${error?.stack ?? error}`);
  process.exit(1);
});
