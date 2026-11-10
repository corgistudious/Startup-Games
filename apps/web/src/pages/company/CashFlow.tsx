import { Panel, Money, Empty } from '@/components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SECTIONS = [
  ['operating', 'Lưu chuyển tiền từ hoạt động kinh doanh'],
  ['investing', 'Lưu chuyển tiền từ hoạt động đầu tư'],
  ['financing', 'Lưu chuyển tiền từ hoạt động tài chính'],
] as const;

/** Direct-method cash flow statement built from the ledger. */
export function CashFlowStatement({ cf, title, eyebrow }: { cf: any; title: string; eyebrow?: string }) {
  if (!cf) return null;
  return (
    <Panel title={title} eyebrow={eyebrow ?? 'Phương pháp trực tiếp, lập từ sổ cái'}>
      {cf.lines.length === 0 ? (
        <Empty title="Chưa có dòng tiền trong kỳ" />
      ) : (
        <dl className="space-y-4 text-sm">
          {SECTIONS.map(([key, label]) => (
            <div key={key}>
              <div className="eyebrow mb-1.5">{label}</div>
              {cf.lines
                .filter((l: any) => l.section === key)
                .map((l: any) => (
                  <div key={l.label} className="flex justify-between gap-3 py-0.5">
                    <dt className="text-ink-300">{l.label}</dt>
                    <dd>
                      <Money value={l.amount} signed />
                    </dd>
                  </div>
                ))}
              <div className="mt-1 flex justify-between border-t pt-1 font-medium" style={{ borderColor: 'var(--line)' }}>
                <dt className="text-white">Lưu chuyển thuần</dt>
                <dd>
                  <Money value={cf[key]} signed />
                </dd>
              </div>
            </div>
          ))}
          <div className="rounded-xl bg-ink-950/50 p-3">
            <div className="flex justify-between">
              <dt className="text-ink-300">Tiền đầu kỳ</dt>
              <dd>
                <Money value={cf.opening} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-300">Lưu chuyển thuần trong kỳ</dt>
              <dd>
                <Money value={cf.net} signed />
              </dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt className="text-white">Tiền cuối kỳ</dt>
              <dd>
                <Money value={cf.closing} className="text-white" />
              </dd>
            </div>
          </div>
        </dl>
      )}
    </Panel>
  );
}
