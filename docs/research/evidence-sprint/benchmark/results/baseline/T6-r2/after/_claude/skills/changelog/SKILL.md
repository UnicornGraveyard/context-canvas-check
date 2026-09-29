---
name: changelog
description: Drafts release notes from merged pull requests since the last tag. Use when preparing a release.
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git describe:*)
---

# Changelog

1. Find the last tag with `git describe --tags --abbrev=0`.
2. List merged changes since that tag with `git log --oneline <tag>..HEAD`.
3. Group them under Added, Changed and Fixed. One line each, user-facing words.
