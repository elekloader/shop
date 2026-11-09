# The Elekloader Shop's list

This repository holds the list of mods the [Elekloader Shop](https://elekloader.github.io/elekloader/) carries, and
the forms that change it. The site, the loader and the scripts that check every file live in
[elekloader/elekloader](https://github.com/elekloader/elekloader). This repository is only the data, so the shop's
daily updates don't crowd the code's history.

| | |
|---|---|
| `catalog.json` | every mod in the shop: its author's repository, the release or commit, the file and its sha256 |
| `sections.json` | the shop's sections (pages of whole repositories, such as Splash & screens) |

## Put your mod in the shop

Use the **[Submit a mod](../../issues/new?template=submit-mod.yml)** form. A bot checks your release with
elekloader's own tools, comments with the result and opens a pull request; an update to a mod you already have in the
shop merges by itself. The whole guide is [docs/SHOP.md](https://github.com/elekloader/elekloader/blob/main/docs/SHOP.md).

- To take a mod out: the **[Remove a mod](../../issues/new?template=remove-mod.yml)** form.
- To report a card's picture: the **[Report a picture](../../issues/new?template=report-picture.yml)** form.
- Newer releases of mods already listed come in by themselves once a day, unless the author opted out.

Please don't edit `catalog.json` by hand in a pull request unless a maintainer asks you to: the form's bot writes it in
the layout the checks expect.

## How it fits together

- `.github/workflows/mod-submission.yml` and `shop-updates.yml` check out elekloader's `main` and run its
  `packaging/submit_mod.py` and `packaging/shop_updates.py` on this `catalog.json`.
- `.github/workflows/check.yml` runs elekloader's unit tests on this list for every pull request.
- `.github/workflows/pages.yml` builds the shop's own site, <https://elekloader.github.io/shop/>: elekloader's web
  page, from a checkout of elekloader at the commit or tag in `elekloader.ref` (a pull request here moves it), with
  this list, and pushes it to the branch `gh-pages`, which Pages serves (one commit, replaced on every deploy).
  It runs on every push to `main`; the bots start it after their own merges.
- elekloader's `pages.yml` still reads this repository's `main` (its repository variable `SHOP_REPO`) for
  <https://elekloader.github.io/elekloader/>, and a merge here starts it with the secret `SITE_DISPATCH`: the bots'
  own merges start it themselves, and `site.yml` starts it for any other change to the list on `main` (or by hand:
  Actions > Redeploy the site).

The list's history up to the move is kept: `git log catalog.json` goes back to the shop's first day in elekloader,
and `elekloader/elekloader#N` in the older messages are that repository's pull requests.

The list is part of elekloader and under the same licence, GPL-2.0-or-later. The mods it lists are their authors',
under their own licences.
