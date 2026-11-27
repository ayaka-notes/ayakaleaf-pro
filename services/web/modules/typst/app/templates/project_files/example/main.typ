// Typst "Example" project — a faithful translation of the TeX example
// project (services/web/app/templates/project_files/example-project-sp),
// owner ask 2026-09-13 ("use the tex example project as basis").
//
// Dependency-free (core Typst only — the typst compile image runs with
// network disabled). Verified syntax target: typst 0.15.x.

// Language setting.
// Replace `en` / `US` with e.g. `de` to change the document language (and
// the spell-check language of the editor).
#set text(lang: "en", region: "US")

// Set page size and margins.
// Replace the US `letter` dimensions (8.5in x 11in) with `width: 21cm, height: 29.7cm`
// for UK/EU standard (A4) size.
#set page(width: 8.5in, height: 11in, margin: (top: 2cm, bottom: 2cm, left: 3cm, right: 3cm))

// Core only: mathematics, figures, tables, links and bibliography are all
// built into Typst — no packages to declare.

#align(center)[#text(size: 30pt, weight: "bold")[Your Paper]]
#align(center)[#text(size: 14pt)[You]]

#box(
  width: 100%,
  inset: 10pt,
  fill: black.lighten(95%),
  [
    #text(weight: "bold")[Abstract]
    Your abstract.
  ]
)

= Introduction

Your introduction goes here! Simply start writing your document and use the
Recompile button to view the updated PDF preview. Examples of commonly used
syntax and features are listed below, to help you get started.

Once you're familiar with the editor, you can find various project settings
in the editor menu, accessed via the button in the very top left of the
editor.

= Some examples to get started

== How to create Sections and Subsections

Simply use the `=` and `==` heading syntax, as in this example document! All
the formatting and numbering is handled automatically. You can also create
new sections and subsections via the buttons in the editor toolbar.

== How to include Figures

First you have to upload the image file from your computer using the upload
link in the file-tree menu. Then include it with the `image` function, and
use `figure` with a `caption` to get a number and a caption. See the code for
Figure @fig:frog in this section for an example.

Note that your figure will automatically be placed in the most appropriate
place for it, given the surrounding text and taking into account other
figures or tables that may be close by.

#figure(
  image("frog.jpg", width: 25%),
  caption: [This frog was uploaded via the file-tree menu.]
) <fig:frog>

== How to add Tables

Use `table` for basic tables --- see Table @tab:widgets, for example.

#figure(
  table(
    columns: (1fr, 1fr),
    table.header([Item], [Quantity]),
    [Widgets], [42],
    [Gadgets], [13],
  ),
  caption: [An example table.]
) <tab:widgets>

== How to add Comments and Track Changes

Comments can be added to your project by highlighting some text and clicking
"Add comment" in the top right of the editor pane. To view existing
comments, click on the Review menu in the toolbar above. To reply to a
comment, click on the Reply button in the lower right corner of the comment.
You can close the Review pane by clicking its name on the toolbar when
you're done reviewing for the time being.

Track changes can be toggled on or off using the option at the top of the
Review pane (when enabled for your build). Track changes allow you to keep
track of every change made to the document, along with the person making
the change.

== How to add Lists

You can make lists with automatic numbering …

+ Like this,
+ and like this.

… or bullet points …

@ Like this,
@ and like this.

== How to write Mathematics

Typst is great at typesetting mathematics. Let $ X_1, X_2, \ldots, X_n $ be a
sequence of independent and identically distributed random variables with
$ E[X_i] = \mu $ and $ text("Var")[X_i] = σ^2 < ∞ $, and let

$ S_n = \dfrac{X_1 + X_2 + \cdots + X_n}{n} = \dfrac{1}{n} Σ_i^n X_i $

denote their mean. Then as $ n $ approaches infinity, the random variables
$ √(n) (S_n - \mu) $ converge in distribution to a normal $ N(0, σ^2) $.

== How to change the margins and paper size

Usually the template you're using will have the page margins and paper size
set correctly for that use-case. For example, if you're using a journal
article template provided by the journal publisher, that template will be
formatted according to their requirements. In these cases, it's best not to
alter the margins directly.

If however you're using a more general template, such as this one, and would
like to alter the margins, edit the `#set page` rule at the top of this
example file.

== How to change the document language and spell check settings

Typst supports many different languages, including multiple different
languages within one document.

To configure the document language, edit the `#set text(lang: ..., region: ...)`
setting at the top of this example project.

To change the spell check language, open the editor menu at the top left of
the editor window, scroll down to the spell check setting, and adjust
accordingly.

== How to add Citations and a References List

You can simply upload a `.bib` file containing your BibTeX entries, created
with a tool such as JabRef. You can then cite entries from it, like this:
~@greenwade93 Remember to name the `.bib` file in the `#bibliography`
call at the bottom of this file.

== Good luck!

We hope you find Typst useful!

= References

#bibliography("sample.bib")
