'use client';

import { GateDemo } from './GateDemo';
import { LedgerDemo } from './LedgerDemo';
import { Plate, RiseHero, RiseNav } from './Rise';
import {
  AfterSection,
  ClosingSection,
  NumbersSection,
  PolicySection,
  ProofSection,
  RiseFooter,
  RuleSection,
  Ticker,
} from './RiseSections';

/**
 * The AIRLOCK front door.
 *
 * A single rounded plate per section on a warm ground — light, generous, and
 * deliberately the opposite temperature to the console, which is a dark
 * instrument panel. The page is the room; the product is the instrument in it.
 *
 * Two of these plates are not marketing. `#gate` runs the real `openGate()` on
 * a dossier the reader assembles, and `#ledger` verifies a real hash chain in
 * the reader's own browser and lets them break it. Both are quoted as dark
 * panels rather than restyled to match the page, because they are the actual
 * product running inside it and making them look like the page would hide the
 * one fact worth advertising.
 *
 * That is the whole editorial line: a product whose argument is "do not take
 * our word for it" should not have a front door that asks you to.
 */
export function Landing() {
  return (
    <div className="lp min-h-screen">
      <RiseNav />
      <RiseHero />
      <Ticker />

      <RuleSection />

      <Plate
        id="gate"
        index="03/07"
        label="Try the gate"
        title="Try to open it."
        standfirst={
          <>
            The controls below build a real Change Dossier and pass it to the real{' '}
            <span className="evidence text-[var(--lp-ink)]">openGate()</span> — the same function the console calls and
            the server re-runs before it writes anything. Every combination is a live evaluation. See if you can find
            one that opens a door it should not.
          </>
        }
      >
        {/* The product, quoted. Dark on purpose. */}
        <div className="lp-instrument overflow-hidden p-4 sm:p-6">
          <GateDemo />
        </div>
      </Plate>

      <ProofSection />
      <PolicySection />
      <AfterSection />

      <Plate
        id="ledger"
        index="06/07"
        label="The ledger"
        title="Break it yourself."
        standfirst={
          <>
            Decided changes are sealed into a hash chain, so editing the audit log is detectable by anyone holding an
            older copy of a single hash. Rewrite a record below and watch every link after it fail — the check runs in{' '}
            <em className="not-italic text-[var(--lp-ink)]">your</em> browser, which is rather the point. A tamper check
            performed by the system holding the data proves considerably less than one performed by the person who does
            not trust it.
          </>
        }
      >
        <div className="lp-instrument overflow-hidden p-4 sm:p-6">
          <LedgerDemo />
        </div>
      </Plate>

      <NumbersSection />
      <ClosingSection />
      <RiseFooter />
    </div>
  );
}
