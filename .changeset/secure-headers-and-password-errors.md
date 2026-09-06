---
'@usehenri/core': minor
---

Three answers to the dynamic pass: `Permissions-Policy`, a Content Security Policy without wildcards, and a password below the policy as a validation failure.

The ZAP baseline scan that `henri audit` now has a companion for reads the answers a running application gives, and it found two headers and one status code worth changing.

**`Permissions-Policy` is sent for every application.** helmet sets no such header, and an absent one is a permission granted: any script the page runs may ask for the camera, the microphone or the location, and the person is prompted. henri denies them, along with the other powerful features. Name the ones you use with `config.helmet.permissionsPolicy` (`"geolocation=(self)"`), or `false` to send nothing.

**The Content Security Policy names its origins.** helmet's defaults leave `https:` in `style-src` and `font-src`, which is every host on the internet. A stylesheet or a font from somewhere else is now an origin you name in `config.helmet`, like a script already was.

**A password below the policy is a 422, not a 500.** `henri.user.encrypt()` threw a plain `Error`, so a `User.create()` with a short password came out of the adapter as an unrecognized failure: `henri.model.errors()` answered `null`, the controller rethrew and the person got a 500 carrying the raw message. It now throws with the shape every adapter rejects an invalid write with, so a controller that already handles a validation failure handles this one without knowing it exists:

```js
try {
  user = await User.create(req.permit('email', 'password'));
} catch (error) {
  const errors = henri.model.errors(error); // { password: 'must be at least 12 characters' }

  if (!errors) {
    throw error;
  }

  return res.boom.badData('the account could not be created', { errors });
}
```

The error also carries `codes` (`missing`, `too_short`, `too_long`) for a client that translates the message itself.
