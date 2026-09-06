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
    // on a page, never in an API answer, and gone with the person
    phone: { maxLength: 30, personal: { expose: false }, type: 'string' },
  },
};
