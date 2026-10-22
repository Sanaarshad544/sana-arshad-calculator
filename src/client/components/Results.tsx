import { forwardRef } from 'react';
import type { CalcResult, RateLabels } from '../billEditor.js';
import { money } from './ui.js';

/** One line of a saved bill: the item, its price and (split by items) who shared it. */
export interface ReceiptItem {
  name: string;
  cents: number | null;
  sharedBy?: string;
}

interface Props {
  result: CalcResult | null;
  currency: string;
  /** Group bills: names by member id, and who paid. */
  names?: Map<string, string>;
  payerId?: string | null;
  /** The rate behind tax, other charges and tip, e.g. "(5%)". */
  rates?: RateLabels;
  /** A saved bill shown read-only: its heading and item lines, and no "results ready" announcement. */
  title?: string;
  items?: ReceiptItem[];
}

/**
 * The receipt. While editing it holds the results ("Press Calculate to see
 * results" until then); a saved bill is shown as the whole receipt, items included.
 */
export const Results = forwardRef<HTMLElement, Props>(function Results({ result, currency, names, payerId, rates, title, items }, ref) {
  const m = (cents: number) => money(cents, currency);
  const editing = title === undefined;
  const headingId = editing ? 'results-heading' : 'receipt-heading';
  return (
    <div className="receipt-wrap">
      <section ref={ref} className="results receipt" aria-labelledby={headingId} tabIndex={editing ? -1 : undefined}>
        <h2 id={headingId} className="section-title">
          {title ?? 'Results'}
        </h2>
        {editing && (
          <div className="visually-hidden" aria-live="polite">
            {result ? `Results ready. Total ${m(result.totals.totalCents)}.` : ''}
          </div>
        )}
        {items && items.length > 0 && (
          <ul className="receipt-items" aria-label="Items">
            {items.map((it, i) => (
              <li key={i} className="receipt-item">
                <div className="receipt-line">
                  <span className="receipt-item-name">{it.name}</span>
                  <span className="receipt-amount">{it.cents === null ? '' : m(it.cents)}</span>
                </div>
                {it.sharedBy && <p className="muted small">Shared by {it.sharedBy}</p>}
              </li>
            ))}
          </ul>
        )}
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
                  <p className="muted payer-line">
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
