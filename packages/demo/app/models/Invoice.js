// The two types a JavaScript number cannot carry, on the adapter core's
// tests boot: `decimal` for money and `bigint` for an identifier that comes
// from somewhere else and does not fit a 32-bit column.
//
// A double would answer `1.0000000000000007` for a hundred cents and
// `9223372036854776000` for the largest 64-bit integer, so both cross into
// JavaScript as exact decimal strings on every adapter -- `'19.99'`,
// `'9223372036854775807'` -- and that is what `res.resource()`, `toJSON()`
// and a version diff hold. See `base/exact.js`.
module.exports = {
  options: { timestamps: true, versioned: true },
  schema: {
    // Money: two digits after the point, and a value with more of them is
    // refused rather than rounded into the column
    amount: { precision: 12, scale: 2, type: 'decimal' },
    // The default settings, 19 digits with 4 after the point: a unit price
    // wants more than money does
    rate: { type: 'decimal' },
    // What the accounting system calls it. Past 2,147,483,647, which is
    // where an `integer` column stopped
    reference: { type: 'bigint', unique: true },
    title: { required: true, type: 'string' },
  },
};
