/**
 * Compile-time proof of the gate invariant.
 *
 * This file contains no runtime assertions. It is a test in the sense that it
 * must keep compiling: every `@ts-expect-error` below asserts that the line
 * under it is a type error. If someone ever weakens `ApprovalGrant` so that a
 * grant can be forged without `openGate`, the expected error disappears, tsc
 * reports "unused @ts-expect-error", and `npm run build` fails.
 *
 * That is what "enforced in code" means here: the approval path cannot be
 * opened by accident, because there is no value a caller could construct.
 */
import type { ApprovalGrant, BreakGlassOverride } from './gate.js';

// A component that renders Approve. It accepts proof, not a boolean.
declare function renderApproveControl(grant: ApprovalGrant): void;

// The break-glass control. A different door, so a different key.
declare function renderBreakGlassControl(override: BreakGlassOverride): void;

/* -------------------------------------------------------------------------- */
/* A grant cannot be forged                                                    */
/* -------------------------------------------------------------------------- */

// 1. An object literal cannot satisfy ApprovalGrant — the witness symbol is
//    module-private, so no external literal can carry it.
// @ts-expect-error - a hand-written grant is not a grant
renderApproveControl({
  dossier_id: 'd1',
  kind: 'UNDO',
  irreversible: false,
  approver: 'x',
  verified_at: undefined,
  seals_required: 1,
  seals_held: 0,
  final: true,
});

// 2. Nor can a bare truthy value stand in for one.
// @ts-expect-error - "the certificate looked fine" is not proof
renderApproveControl(true as unknown as { dossier_id: string });

// 3. Nor an empty object.
// @ts-expect-error - absence of a certificate is not a certificate
renderApproveControl({});

// 4. Nor null/undefined.
// @ts-expect-error - a missing grant is not a grant
renderApproveControl(null);

/* -------------------------------------------------------------------------- */
/* The two witnesses are not interchangeable                                   */
/* -------------------------------------------------------------------------- */

declare const grant: ApprovalGrant;
declare const override: BreakGlassOverride;

// 5. Breaking the glass does not open the airlock. An override carries its own
//    private symbol, so it cannot be handed to the Approve control — which is
//    what keeps "we went around the gate" from being recorded as "the gate
//    opened".
// @ts-expect-error - a break-glass override is not an approval
renderApproveControl(override);

// 6. And the reverse: a legitimate approval cannot be laundered into the
//    break-glass ledger, which would put a false emergency on someone's name.
// @ts-expect-error - an approval is not an override
renderBreakGlassControl(grant);

// Each accepts its own, which is what makes the two errors above meaningful
// rather than an artefact of both functions rejecting everything.
renderApproveControl(grant);
renderBreakGlassControl(override);

export {};
