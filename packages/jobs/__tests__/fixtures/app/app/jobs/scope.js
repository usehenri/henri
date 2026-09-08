// Says which tenant the runner entered before it called this.
//
// The whole point of the column is that a job's `perform()` runs where
// there is no request, so this records what `henri.tenancy.current()`
// answers *inside* the attempt -- which is the only place the question can
// be asked honestly.
module.exports = {
  perform: async (args, context) => {
    const tenancy = context.henri && context.henri.tenancy;
    const scope = (tenancy && tenancy.current()) || null;

    global.__henriJobScopes = global.__henriJobScopes || [];
    global.__henriJobScopes.push({
      row: context.job.tenant,
      scope,
      token: (args && args.token) || null,
    });

    // Long enough that two attempts of two tenants overlap, which is what
    // makes the async context worth having rather than a field on `this`
    await new Promise((resolve) =>
      setTimeout(resolve, (args && args.wait) || 0)
    );

    return {
      after: (tenancy && tenancy.current()) || null,
      scope,
    };
  },
};
