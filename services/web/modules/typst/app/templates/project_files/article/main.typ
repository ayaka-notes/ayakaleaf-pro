// Article template — a minimal article that compiles out of the box.
// Dependency-free (core typst only — the typst docker image runs with
// network disabled): page setup, headings, a table, and real citations
// (`~@key` + `#bibliography`) via the bundled references.bib. Verified
// against typst 0.15.1 (pandoc/typst:latest-alpine@sha256:92cacfbc... ,
// 2026-09-10) — current stable, per owner decision.
#set page(width: 170mm)

= <%= project_name %>

*Author*

*Affiliation*

#heading("Introduction")

Welcome to your article. Replace this placeholder text with your own. Add
more sections below, or `#include` other `.typ` files.

#heading("Methods")

This section demonstrates the second heading of the outline. Add your own
sections below.

#heading("Results")

As the table below shows, the treatment group improved, as was also noted
in the literature~@example:2025.

#table(columns: (1fr, 1fr), table.header(
  "Condition", "Outcome",
  "Baseline", "Reference",
  "Treated", "Improved",
))

= References

#bibliography("references.bib")
