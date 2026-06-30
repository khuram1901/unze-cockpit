import { CashFlowParsed } from "./cash-flow-parser";
import { BankPositionParsed } from "./bank-position-parser";

export type ReconciliationResult = {
  matches: boolean;
  cashFlowClosing: number;
  bankPositionTotal: number;
  diff: number;
};

export function reconcile(
  cashFlow: CashFlowParsed,
  bankPosition: BankPositionParsed
): ReconciliationResult {
  const cashFlowClosing = cashFlow.closingBalanceUnzeTrading;
  const bankPositionTotal = bankPosition.totalAvailableBalance;
  const diff = cashFlowClosing - bankPositionTotal;
  const absDiff = Math.abs(diff);
  const absValueDiff = Math.abs(Math.abs(cashFlowClosing) - Math.abs(bankPositionTotal));

  const signsDiffer = Math.sign(cashFlowClosing) !== Math.sign(bankPositionTotal) && cashFlowClosing !== 0 && bankPositionTotal !== 0;
  const matches = absDiff === 0 || (absValueDiff === 0 && signsDiffer);

  return {
    matches,
    cashFlowClosing,
    bankPositionTotal,
    diff: matches ? 0 : absDiff,
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Imperial's bank position PDF labels each block with the *reporting* date,
// which is one calendar day after the cash-flow day whose closing balance it
// carries (e.g. cash flow "29/06 Today Closing Balance" appears under bank
// position's "30/06" total). A literal date match can coincidentally collide
// with an unrelated day in a different PDF, so prefer matching by balance
// value (unambiguous ground truth) before falling back to the +1 day
// convention, then a literal same-date match as a last resort.
export function matchBankPositionToCashFlow(
  cashFlow: CashFlowParsed,
  bankPositions: BankPositionParsed[]
): BankPositionParsed | undefined {
  if (bankPositions.length === 1 && !cashFlow.date && !bankPositions[0].date) return bankPositions[0];
  if (!cashFlow.date) return undefined;

  const byValue = bankPositions.find(
    (b) => Math.abs(b.totalAvailableBalance - cashFlow.closingBalanceUnzeTrading) < 0.01
  );
  if (byValue) return byValue;

  const nextDay = addDays(cashFlow.date, 1);
  const offsetMatch = bankPositions.find((b) => b.date === nextDay);
  if (offsetMatch) return offsetMatch;

  const exact = bankPositions.find((b) => b.date === cashFlow.date);
  if (exact) return exact;

  return undefined;
}
