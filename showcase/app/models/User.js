// Speakers and members of the program committee.
//
// The model matches `config.user.model`, so the Drizzle adapter adds `email`
// (unique, lowercased, validated), `password` (bcrypt, never selected) and
// `roles` (a JSON column, never mass assignable) to the schema below, plus
// `hasRole()`, `setRoles()` and the class method `User.setRoles(id, roles)`.
// Only `id`, `email`, `roles` and `config.user.public` ever leave the server.
//
// Everything here is about a person, and says so. `personal` is what puts a
// field in `henri privacy:export`, erases it in `henri privacy:erase` and
// masks it in the logs; `name`, `bio` and `company` still reach a page,
// because the programme is made of them. `phone` does not: `expose: false`
// keeps it out of every answer henri builds, so the only way it ever leaves
// is a controller that asks for it by name.
//
// `phone` is also the one field of this application the database never
// holds in the clear. `encrypted: true` is the randomised scheme: the same
// number written twice is two different envelopes, so a dump of this table
// gives away nothing at all -- not even which speakers share a number --
// and nothing can query it, which is fine, because nothing does. The key is
// config.encryption.keys, it is not config.secret, and it is not in this
// repository: HENRI_ENCRYPTION_KEYS carries it (see .env.example).
//
// `bio`, `company` and `name` are not encrypted: they are the programme.
// They are on a page the moment a proposal is accepted, so encrypting them
// would protect a dump of a table whose contents are published anyway,
// while making them unsortable and unsearchable. Encryption at rest is for
// what an application holds and never shows.
module.exports = {
  schema: {
    bio: { maxLength: 600, personal: true, type: 'text' },
    company: { maxLength: 80, personal: true, trim: true, type: 'string' },
    name: {
      maxLength: 80,
      minLength: 2,
      personal: true,
      required: true,
      trim: true,
      type: 'string',
    },
    // What the programme chairs call a speaker with the day before: never
    // on a page, never in an API answer, ciphertext in the column, and
    // gone with the person
    phone: {
      encrypted: true,
      maxLength: 30,
      personal: { expose: false },
      type: 'string',
    },
  },
};
