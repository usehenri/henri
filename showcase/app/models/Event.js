// One edition of the conference: the thing proposals are submitted to.
//
// `state` drives what the rest of the application allows: proposals can only
// be submitted while the call for papers is `open`, and decisions are only
// public once the edition is `announced`.
module.exports = {
  schema: {
    city: { maxLength: 80, trim: true, type: 'string' },
    closesAt: { type: 'date' },
    name: {
      maxLength: 120,
      minLength: 4,
      required: true,
      trim: true,
      type: 'string',
    },
    opensAt: { type: 'date' },
    slug: {
      index: true,
      match: [/^[a-z0-9-]+$/, 'may only hold lowercase letters, digits and -'],
      required: true,
      type: 'string',
      unique: true,
    },
    state: {
      default: 'draft',
      enum: ['draft', 'open', 'closed', 'announced'],
      type: 'string',
    },
    summary: { maxLength: 400, type: 'text' },
    year: { max: 2100, min: 2000, required: true, type: 'integer' },
  },
};
