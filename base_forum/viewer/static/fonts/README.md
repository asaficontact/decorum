# Fonts

Both are under the SIL Open Font License 1.1 (the licence files are beside them) and are served by the viewer itself,
so the page loads nothing from outside.

- `source-serif-4.woff2`: Source Serif 4 (Adobe, https://github.com/adobe-fonts/source-serif), roman, weights
  400 to 700 with its optical-size axis, subset to Latin. Names and titles.
- `decorum-ui-sans.woff2`: a subset of IBM Plex Sans (IBM, https://github.com/IBM/plex), roman, weights 400 to 700,
  width fixed at 100, subset to Latin. Everything else. Plex's licence reserves the name "Plex" for the original, and
  a subset is a modified version, so this file is renamed "Decorum UI Sans"; its copyright notice is unchanged.

Made with fontTools (`subset`, then `varLib.instancer`), Unicode ranges: Basic Latin, Latin-1, general punctuation,
arrows, the euro, trademark and math signs the page uses.
