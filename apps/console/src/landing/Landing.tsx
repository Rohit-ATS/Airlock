'use client';

import { GateDemo } from './GateDemo';
import { LedgerDemo } from './LedgerDemo';
import { Band, Hero, Nav } from './Rise';
import {
  AfterSection,
  Closing,
  Footer,
  NumbersSection,
  PolicySection,
  ProofSection,
  RuleSection,
  Stack,
} from './RiseSections';

/**
 * The AIRLOCK front door.
 *
 * Full bleed, hairline-separated, no cards. The hierarchy is carried by scale
 * and whitespace: the display face runs to 10.5vw, the body sits at 15px, and
 * that gap does the work a border would otherwise have to do.
 *
 * Two of these bands are not marketing. `#gate` runs the real `openGate()` on a
 * dossier the reader assembles, and `#ledger` verifies a real hash chain in the
 * reader's own browser and invites them to break it. Both invert to black,
 * because they are the product itself running inside the page rather than
 * another section describing it — and the colour change is the honest signal
 * that you have stopped reading and started operating something.
 */
export function Landing() {
  return (
    <div className="lp min-h-screen">
      <Nav />
      <Hero />
      <Stack />

      <RuleSection />

      <Band
        id="gate"
        index="03 / 07"
        label="Try the gate"
        dark
        title={
          <>
            Try to <span className="lp-serif-em text-[var(--lp-signal-pale)]">open it.</span>
          </>
        }
        lede={
          <>
            The controls below build a real Change Dossier and pass it to the real{' '}
            <span className="evidence text-[var(--lp-pale)]">openGate()</span> — the same function the console calls
            and the server re-runs before it writes anything. Every combination is a live evaluation. See if you can
            find one that opens a door it should not.
          </>
        }
      >
        <GateDemo />
      </Band>

      <ProofSection />
      <PolicySection />
      <AfterSection />

      <Band
        id="ledger"
        index="06 / 07"
        label="The ledger"
        dark
        title={
          <>
            Break it <span className="lp-serif-em text-[var(--lp-signal-pale)]">yourself.</span>
          </>
        }
        lede={
          <>
            Decided changes are sealed into a hash chain, so editing the audit log is detectable by anyone holding an
            older copy of a single hash. Rewrite a record below and watch every link after it fail — the check runs in{' '}
            <em className="not-italic text-[var(--lp-pale)]">your</em> browser, which is rather the point. A tamper
            check performed by the system holding the data proves considerably less than one performed by the person
            who does not trust it.
          </>
        }
      >
        <LedgerDemo />
      </Band>

      <NumbersSection />
      <Closing />
      <Footer />
    </div>
  );
}
