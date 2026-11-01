# Publishing to GitHub

Nothing has been pushed anywhere. The repository is local with real commits; `opsmind.bundle` is the whole history in one file.

## From the bundle (full history)

```bash
git clone opsmind.bundle opsmind          # restores all branches and tags
cd opsmind
git log --oneline --decorate               # review history
git tag -n                                 # v1-fullstack, v2-data-intelligence
```

## The ZIP

`OpsMind_V2_DataIntelligence.zip` is a clean snapshot of the `v2-data-intelligence` tag (`git archive`): source only, **no `.git` folder** and no history. Use the bundle for history.

## Push (after creating an EMPTY repository on github.com — no README, no licence)

```bash
git remote add origin https://github.com/<you>/opsmind.git
git branch -M main
git push -u origin main
git push origin --tags                     # v1-fullstack and v2-data-intelligence
```

If you already published V1 from the earlier bundle, pull this one in as an update instead of re-creating the repository:

```bash
cd <your existing opsmind clone>
git fetch /path/to/opsmind.bundle main:v2-import
git merge --ff-only v2-import              # V2 history continues V1's; fast-forward only
git fetch /path/to/opsmind.bundle --tags
git push origin main --tags
```

`--ff-only` fails loudly if histories differ, which would mean something was rewritten; do not force-push.

## Author identity

Commits use a placeholder identity. To set yours for future commits:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

Changing the author on existing commits changes their hashes (and invalidates the tags — recreate with `git tag -f <name> <new-hash>`). Do it before the first push or not at all; `git filter-repo --mailmap <file>` is the tool.

## Secrets

`.env` is git-ignored. `.env.example` contains placeholders only. Never commit `INTERNAL_API_KEY`, `JWT_SECRET` or database passwords.
