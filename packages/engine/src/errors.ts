/** Business rule violation. Message is safe to show players (Vietnamese). */
export class GameError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}
export const fail = (code: string, message: string, status = 400): never => {
  throw new GameError(code, message, status);
};

/** Translate DB constraint failures that represent business rules. */
export function mapDbError(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23514' && e.constraint === 'accounts_no_overdraft') return new GameError('insufficient_funds', 'Không đủ tiền để thực hiện giao dịch.');
  if (e.code === '23514' && (e.constraint === 'inventory_qty_check' || e.constraint === 'inventory_check')) return new GameError('insufficient_stock', 'Không đủ hàng trong kho.');
  return err;
}
