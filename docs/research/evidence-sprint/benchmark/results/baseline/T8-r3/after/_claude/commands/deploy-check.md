---
description: Check that a service is ready to deploy
argument-hint: <service>
allowed-tools: Bash(make test), Bash(make lint)
---

Run `make lint` and `make test` for $ARGUMENTS and list anything that blocks a deploy.
