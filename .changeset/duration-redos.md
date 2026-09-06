---
'@usehenri/jobs': patch
---

A duration with a long run of whitespace is refused in constant time

`'5m'`, `'2h'` and their friends were matched by a pattern with `\s*` at both ends. Around an optional group that is quadratic: on `'1'` followed by sixty thousand spaces the two star quantifiers split the run between them one position at a time, which measured two seconds before the value was refused. A duration reaches the parser from `henri jobs:perform --in=`, and from whatever an application passes to `enqueue()`, so it is not always a value its author typed.

The surrounding whitespace is trimmed before the pattern runs rather than matched by it. The same input is now refused in under a millisecond, and a test pins it.
