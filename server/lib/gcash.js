// GCash fee and cash effects. One place, so the quote screen and the saved
// transaction always agree.
const round2 = (n) => Math.round(n * 100) / 100;

// Fee = percent of the amount (rounded to whole pesos), but never below the minimum fee.
function calcFee(amount, st) {
  return round2(Math.max(Number(st.gcash_min_fee), Math.round(amount * Number(st.gcash_fee_percent) / 100)));
}

// What each side of the counter gives and gets.
//  cash_in : customer hands over cash (amount + fee); store sends `amount` from the GCash wallet.
//  cash_out: customer sends `amount` to the store wallet; store hands out cash.
//            fee_mode 'deduct'  -> store hands over amount - fee
//            fee_mode 'separate'-> store hands over amount and collects the fee on top
function effects(type, amount, fee, feeMode) {
  if (type === 'cash_in') {
    return { cash_from_customer: round2(amount + fee), cash_to_customer: 0, drawer_change: round2(amount + fee), float_change: -amount };
  }
  const handed = feeMode === 'separate' ? amount : round2(amount - fee);
  const collected = feeMode === 'separate' ? fee : 0;
  return { cash_from_customer: collected, cash_to_customer: handed, drawer_change: round2(collected - handed), float_change: amount };
}

module.exports = { calcFee, effects, round2 };
