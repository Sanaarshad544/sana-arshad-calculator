import { forwardRef } from 'react';
import type { CalcResult, RateLabels } from '../billEditor.js';
import { money } from './ui.js';

interface Props {
  result: CalcResult | null;
  currency: string;
  /** Group bills: names by member id, and who paid. */
  names?: Map<string, string>;
  payerId?: string | null;
  /** The rate behind tax, other charges and tip, e.g. "(5%)". */
  rates?: RateLabels;
}

/** Results below the form. Until Calculate is pressed: "Press Calculate to see results". */
export const Results = forwardRef<HTMLElement, Props>(function Results({ result, currency, names, payerId, rates }, ref) {
  const m = (cents: number) => money(cents, currency);
  return (
    <div className="receipt-wrap">
    <section ref={ref} className="results receipt" aria-labelledby="results-heading" tabIndex={-1}>
      <h2 id="results-heading" className="section-title">
        Results
      </h2>
      <div className="visually-hidden" aria-live="polite">
        {result ? `Results ready. Total ${m(result.totals.totalCents)}.` : ''}
      </div>
      {!result ? (
        <p className="muted">Press Calculate to see results</p>
      ) : (
        <>
          <dl className="totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{m(result.totals.itemsCents)}</dd>
            </div>
            <div>
              <dt>
                Tax{rates?.tax && <span className="rate"> {rates.tax}</span>}
              </dt>
              <dd>{m(result.totals.taxCents)}</dd>
            </div>
            <div>
              <dt>
                Other charges{rates?.other && <span className="rate"> {rates.other}</span>}
              </dt>
              <dd>{m(result.totals.otherCents)}</dd>
            </div>
            <div>
              <dt>
                Tip{rates?.tip && <span className="rate"> {rates.tip}</span>}
              </dt>
              <dd>{m(result.totals.tipCents)}</dd>
            </div>
            <div className="totals-grand">
              <dt>Total</dt>
              <dd data-testid="grand-total">{m(result.totals.totalCents)}</dd>
            </div>
          </dl>
          {result.shares && names && (
            <>
              {payerId && (
                <p className="muted">
                  {names.get(payerId)} paid {m(result.totals.totalCents)}.
                </p>
              )}
              <h3 className="subsection-title">Each person&apos;s share</h3>
              <ul className="shares">
                {result.shares.map((s) => (
                  <li key={s.memberId} className="share" data-testid="share">
                    <div className="share-main">
                      <span className="share-name">{names.get(s.memberId) ?? 'Someone'}</span>
                      <span className="share-amount">{m(s.totalCents)}</span>
                    </div>
                    {s.extraCents > 0 && (
                      <span className="badge">
                        +{s.extraCents} cent{s.extraCents === 1 ? '' : 's'}
                      </span>
                    )}
                    {s.itemsCents !== null && (
                      <p className="share-parts muted">
                        Items {m(s.itemsCents)} · Tax {m(s.taxCents ?? 0)} · Other charges {m(s.otherCents ?? 0)} · Tip {m(s.tipCents ?? 0)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
    </div>
  );
});
