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
