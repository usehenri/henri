// Speakers and members of the program committee.
//
// The model matches `config.user.model`, so the Drizzle adapter adds `email`
// (unique, lowercased, validated), `password` (bcrypt, never selected) and
// `roles` (a JSON column, never mass assignable) to the schema below, plus
// `hasRole()`, `setRoles()` and the class method `User.setRoles(id, roles)`.
// Only `id`, `email`, `roles` and `config.user.public` ever leave the server.
module.exports = {
  schema: {
    bio: { maxLength: 600, type: 'text' },
    company: { maxLength: 80, trim: true, type: 'string' },
    name: {
      maxLength: 80,
      minLength: 2,
      required: true,
      trim: true,
      type: 'string',
    },
  },
};
