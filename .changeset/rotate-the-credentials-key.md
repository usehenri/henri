---
'@usehenri/cli': minor
---

`henri credentials:rotate`: a new key, the same secrets

A key that may have leaked has to stop opening the file, and until now that meant a manual sequence — show the values, generate a key, edit, paste everything back — which is exactly the kind of thing that ends with a secret in a shell history.

```bash
henri credentials:rotate --env production
```

The file is re-encrypted under a fresh key and the values are untouched. The current key has to open the file first, so a rotation is never a way to lose the contents, and the re-encrypted file is read back before the new key is stored: a rotation that cannot be verified puts the old file back and changes nothing.

The new key is written to `config/credentials/<env>.key`, or printed once when `HENRI_CREDENTIALS_KEY` held the old one, because a deployment that deliberately has no key file should not be given one. `--json` never prints it. The old key opens nothing afterwards, so everything holding a copy needs the new one before its next boot.

Closes #57, open since 2018.
