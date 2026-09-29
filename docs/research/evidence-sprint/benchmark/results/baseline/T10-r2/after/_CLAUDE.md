# Platform

Terraform for our AWS accounts (infra/) and Go services (services/).

- Changes to infra/prod need a plan reviewed by a person. Never apply from a session.
- Run `make lint` and `make test` before you finish.
- The sre agent investigates incidents and never edits files.
