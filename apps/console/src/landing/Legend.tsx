'use client';

import { Reveal } from './Rise';

/**
 * The colour index, printed.
 *
 * A landing page does not normally publish its own palette, and this one should,
 * for a reason specific to what AIRLOCK is: the product's entire claim is that
 * the state of a change is legible at a glance. Green means the data came back.
 * Red means the door is shut. Amber means this cannot be undone. If that is
 * true, the key is worth handing to the reader before they open the console —
 * and if it is not true, printing the key is how you find out.
 *
 * It is also the honest way to make the point that most of this page makes in
 * prose. Instrument's second rule is ONE ALARM COLOUR: `--hazard` means
 * irreversible and is not spent on hover, emphasis or brand. A page that tells
 * you that and then shows you every colour it owns, with the count of places
 * each one is allowed to appear, has done more than assert it.
 *
 * The old landing page could not have carried this section, which is the
 * clearest evidence that its palette was decoration: its brand colour, its
 * buttons, its links and its emphasis were all the same orange as `--hazard`.
 * By the time a reader met a real irreversible-change chip, the colour had been
 * trained to mean "AIRLOCK".
 */

const INDEX = [
  {
    token: '--seal',
    swatch: 'var(--lp-proven)',
    bg: 'var(--lp-proven-bg)',
    name: 'Proven',
    chip: 'PROVEN',
    means: 'The change ran against a copy of the real rows and the rollback brought them back byte-identical.',
    where: 'Certificates that passed. The one state in which the gate can open.',
  },
  {
    token: '--fault',
    swatch: 'var(--lp-sealed)',
    bg: 'var(--lp-sealed-bg)',
    name: 'Sealed',
    chip: 'SEALED',
    means: 'Refused. A proof that failed, a policy ceiling, drift, a missing signature, an injection.',
    where: 'Every refusal, and the space where an approve control is not rendered.',
  },
  {
    token: '--hazard',
    swatch: 'var(--lp-irreversible)',
    bg: 'var(--lp-irreversible-bg)',
    name: 'Irreversible',
    chip: 'CANNOT BE UNDONE',
    means: 'There is no inverse. An erasure, a refund, forty thousand emails.',
    where: 'Scope certificates and armed approvals. Never hover, never emphasis, never brand.',
  },
  {
    token: '--ice',
    swatch: 'var(--lp-signal)',
    bg: 'var(--lp-signal-bg)',
    name: 'Interactive',
    chip: 'ACT',
    means: 'Something you can operate: a link, a control, a focus ring.',
    where: 'The only accent on this page. If it is this colour, you can press it.',
  },
] as const;

export function Legend() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {INDEX.map((c, i) => (
        <Reveal key={c.token} delay={i * 70} className="h-full">
          <article className="flex h-full flex-col rounded-[8px] border border-[var(--lp-line)] bg-[var(--lp-raised)] p-5">
            <div className="flex items-center gap-3">
              <span
                className="size-3.5 shrink-0 rounded-[3px]"
                style={{ background: c.swatch, boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 8%)' }}
                aria-hidden
              />
              <h3 className="text-[15px] font-semibold text-[var(--lp-ink)]">{c.name}</h3>
              <span
                className="lp-mono ml-auto rounded-[3px] px-1.5 py-[3px] text-[9.5px] tracking-[0.09em] uppercase"
                style={{ background: c.bg, color: c.swatch }}
              >
                {c.chip}
              </span>
            </div>

            <p className="mt-3.5 text-[13px] leading-[1.55] text-[var(--lp-ink-2)]">{c.means}</p>
            <p className="mt-2.5 text-[12.5px] leading-[1.5] text-[var(--lp-ink-3)]">{c.where}</p>

            <p className="lp-mono mt-auto pt-4 text-[11px] text-[var(--lp-ink-3)]">{c.token}</p>
          </article>
        </Reveal>
      ))}
    </div>
  );
}
