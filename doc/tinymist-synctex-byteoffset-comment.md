<!-- Ready-to-paste comment for Myriad-Dreamin/tinymist#2766 (the --synctex PR). -->

This is a great addition, thank you. One small follow-up that would make it
usable for editor reverse-search (Overleaf / TeXStudio "click to source"): the
records currently carry `(file tag, line)`, which opens the right source line
but not the exact spot within it.

`locate()` already computes the precise position — `node.offset() + offset`, a
byte offset into the source file — and then keeps only the line. If we carry
that byte offset through to the record as the third link field, we get
character-level precision at essentially no extra cost. The SyncTeX spec already
permits it:

    <link> ::= <tag>, <line> (, <column>)?

and for ASCII sources the byte offset *is* the column, so standard viewers are
unaffected (they keep reading `tag,line`); consumers that need the exact spot
can read the third field.

Concretely, for:

    = Alpha

the word `Alpha` then maps to byte 66 of the file, so clicking it places the
cursor on "Alpha" rather than at the start of line 4.

I rebuilt the `--synctex` output and the emitted offset is byte-for-byte the
source position (checked against an independent byte count), and I extended
`test_compile_synctex_records` to assert the new field (it strictly increases
across the two source lines that map to one typeset line). Both compile and pass
under `rust:alpine`.

The patch below applies to `synctex` @ `4eef4a4c`. Happy to open it as a
follow-up commit, or fold it into the PR, whichever you prefer.

---

<patch: tinymist-synctex-byteoffset.patch>
