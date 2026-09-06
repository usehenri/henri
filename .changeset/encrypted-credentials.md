---
'@usehenri/core': minor
'@usehenri/cli': minor
---

Encrypted credentials, per environment: `henri credentials:edit`.

`config/credentials/<env>.json.enc` holds the secrets of one environment and is committed with the application; the key that opens it never is. A deployment then carries one secret instead of twenty, and adding a secret to staging is a commit rather than a round of environment variables.

- **JSON, not YAML.** henri's configuration is JSON, and the decrypted object is applied over it key by key, so both files are written the same way and henri needs no parser it does not already have.
- **The key** is `HENRI_CREDENTIALS_KEY`, or `config/credentials/<env>.key` (64 hexadecimal characters); the variable wins. `henri new` ignores `config/credentials/*.key` from the first commit, `henri credentials:edit` adds the line when it generates a key, and `henri doctor` reports a key that is not ignored (`credentials.ignored`) or that reached the git index (`credentials.committed`). A file with no key stops the boot naming both the file and the variable — never a silent boot without secrets.
- **AES-256-GCM**, from node's own crypto. The envelope is one line, `henri:v1:<iv>:<tag>:<ciphertext>`, and the environment name is authenticated with the content, so a modified file, a wrong key and a `production.json.enc` renamed to `staging.json.enc` all fail loudly instead of decrypting to nonsense. No message quotes the file, the key or a decrypted value, in a log line, an error or `--json`.
- **Precedence**: over the configuration file, under the environment. Each leaf of the decrypted object replaces that one key, so `{ "mail": { "auth": { "pass": "x" } } }` leaves the rest of `mail` alone, and the values are read with `henri.config.get('mail.auth.pass')`. The boot prints the paths the credentials provided and where the key came from, never the values; `henri.config.fromCredentials` holds the same paths.

`henri credentials:edit [--env <name>]` decrypts into a file only you can read (`0600`, in a directory `mkdtemp` creates), opens `EDITOR` or `VISUAL` on it, and encrypts what comes back. The plaintext is removed on every exit path: the editor closing, the editor failing, invalid JSON, and an interrupted process. The first edit of an environment writes the key, the ignore line and a fresh `secret`. `henri credentials:show` prints the decrypted credentials on stdout, and with `--json` the key paths only.
