/** Staff other than a manager or owner may give up to this much off a bill; more needs a manager's PIN */
export const DISCOUNT_FREE_LIMIT_PERCENT = 10;

/** Whether a discount of `amountPaise` on a food total of `basePaise` is over the free limit */
export const discountNeedsApproval = (amountPaise: number, basePaise: number) => amountPaise * 100 > basePaise * DISCOUNT_FREE_LIMIT_PERCENT;
