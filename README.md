# Software Factory Control Plane

A self-hostable control plane that orchestrates humans and AI agents through real engineering workflows — from issue to validated PR — with bounded autonomy, policy enforcement, and full audit trails.

**Status: Early stage. Product requirements are actively being refined ([docs/prd.md](docs/prd.md)).**

## What This Is

A thin orchestration layer that sits between workflow methods (like BMAD), agent runtimes, and coding tools. It manages task intake, context assembly, sandboxed execution, validation, evidence generation, and human approval routing — so AI-assisted engineering work is safe, observable, and controllable.

## What This Is Not

Not an IDE, not a code generation model, not a CI/CD replacement, and not a general-purpose agent framework. Models are replaceable workers. The factory is the pipeline.

## Core Ideas

- **Artifact-first**: Durable documents and evidence packets over chat history
- **Bounded autonomy**: Configurable levels (L0-L4) with qualification gates
- **Human control**: Merge and governance actions always require human approval
- **Security-first**: Sandboxed execution, least-privilege credentials, append-only audit log
- **Model-agnostic**: OpenRouter for multi-vendor routing; swap models via config

## License

Open source (license TBD).
