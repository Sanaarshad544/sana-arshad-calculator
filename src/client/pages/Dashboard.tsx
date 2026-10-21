import { Link } from 'react-router-dom';
import type { CurrencyTotal, DashboardDto } from '../../shared/api.js';
import { api } from '../api.js';
import { useLoad } from '../hooks.js';
import { Alert, Balance, EmptyState, PageHeader, Skeleton, money, niceDate, usePageTitle } from '../components/ui.js';

function TotalsCard({ title, totals, tone, none }: { title: string; totals: CurrencyTotal[]; tone: 'owes' | 'owed'; none: string }) {
  return (
    <section className="card summary-card" aria-labelledby={`sum-${tone}`}>
      <h2 id={`sum-${tone}`} className="section-title">
        {title}
      </h2>
      {totals.length === 0 ? (
        <p className="muted">{none}</p>
      ) : (
        <ul className="summary-list">
          {totals.map((t) => (
            <li key={t.currency} className={tone === 'owes' ? 'amount-owes' : 'amount-owed'}>
              {tone === 'owes' ? '−' : '+'}
              {money(t.cents, t.currency)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardPage() {
  usePageTitle('Dashboard');
  const { data, error, loading } = useLoad(() => api.get<DashboardDto>('/dashboard'), []);

  return (
    <>
      <PageHeader title="Dashboard">
        <Link className="btn btn-primary" to="/solo/new">
          New solo bill
        </Link>
        <Link className="btn btn-primary" to="/group-bill/new">
          New group bill
        </Link>
      </PageHeader>
      <Alert>{error?.message}</Alert>
      {loading && <Skeleton lines={5} />}
      {data && (
        <div className="stack-lg">
          {data.owe.length === 0 && data.owed.length === 0 && data.groups.length > 0 && (
            <p className="callout">You owe nothing and are owed nothing.</p>
          )}
          <div className="grid-2">
            <TotalsCard title="You owe" totals={data.owe} tone="owes" none="You owe nothing." />
            <TotalsCard title="You're owed" totals={data.owed} tone="owed" none="You're owed nothing." />
          </div>

          <section className="card" aria-labelledby="dash-groups">
            <h2 id="dash-groups" className="section-title">
              Your groups
            </h2>
            {data.groups.length === 0 ? (
              <EmptyState text="No groups yet. Create one to start splitting with friends." action={{ to: '/groups/new', label: 'Create group' }} />
            ) : (
              <ul className="link-list">
                {data.groups.map((g) => (
                  <li key={g.id}>
                    <Link to={`/groups/${g.id}`} className="link-row">
                      <span className="link-row-title">{g.name}</span>
                      <Balance cents={g.myBalanceCents} currency={g.currency} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="dash-solo">
            <h2 id="dash-solo" className="section-title">
              Latest solo bills
            </h2>
            {data.soloBills.length === 0 ? (
              <EmptyState text="No solo bills yet. Total your first bill to keep a record of it." action={{ to: '/solo/new', label: 'New solo bill' }} />
            ) : (
              <ul className="link-list">
                {data.soloBills.map((b) => (
                  <li key={b.id}>
                    <Link to={`/solo/${b.id}`} className="link-row">
                      <span className="link-row-title">
                        {b.name}
                        <span className="muted small"> · {niceDate(b.date)}</span>
                      </span>
                      <span>{money(b.totalCents, b.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
