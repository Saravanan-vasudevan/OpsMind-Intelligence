# Publishing to GitHub

Nothing has been pushed anywhere. The repository is local with real commits.

```bash
git log --oneline                       # review history
git tag -n                              # checkpoints (v1-fullstack, ...)

# 1. Create an empty repository on github.com (no README), then:
git remote add origin https://github.com/<you>/opsmind.git
git branch -M main
git push -u origin main
git push origin --tags

# Later versions
git pull --ff-only
# ...work, commit...
git push && git push origin --tags
```

Commit author: the local commits use a placeholder identity. To set yours for future commits:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

To change the placeholder author on existing commits without touching dates, use `git filter-repo --mailmap <file>` (a separate tool) before the first push. It changes commit hashes, so recreate the tags afterwards (`git tag -f <name> <new-hash>`).
