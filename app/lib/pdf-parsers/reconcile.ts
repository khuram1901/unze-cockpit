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
  const diff = Math.abs(cashFlowClosing - bankPositionTotal);

  return {
    matches: diff === 0,
    cashFlowClosing,
    bankPositionTotal,
    diff,
  };
}
