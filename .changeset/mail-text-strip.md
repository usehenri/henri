---
'@usehenri/core': patch
---

The derived plain text part of a mail no longer keeps a fragment of a malformed tag. Stripping tags in one pass turns `<scr<script>ipt>` into `<script`, and an unterminated opener matches no tag pattern at all, so a crafted or simply broken document left something element shaped in the text a reader sees. Tags are now removed until the string stops changing, and a leftover opener is dropped. A less-than sign that is not a tag is untouched.
