# Documentation

This directory contains Architecture Decision Records (ADRs) and technical documentation for the WWWMW project.

## Architecture Decision Records (ADRs)

ADRs document significant architectural and design decisions made in the project. Each ADR captures the context, decision, alternatives considered, and consequences.

### Format

Each ADR follows this structure:

- **Status:** Accepted, Proposed, Deprecated, or Superseded
- **Date:** When the decision was made
- **Context:** The problem or situation requiring a decision
- **Decision:** What was decided and why
- **Alternatives Considered:** Other options evaluated
- **Consequences:** Positive, negative, and neutral impacts
- **Implementation Notes:** Technical details and guidance

### Current ADRs

- **[ADR-001: DNS Speed Check Enhancement](./ADR-001-dns-speed-check-enhancement.md)** - Enhanced DNS checking with dual providers, DNSSEC validation, and CDN detection

## Contributing

When making significant architectural decisions:

1. Create a new ADR using the format above
2. Number it sequentially (ADR-XXX)
3. Update this README with a link
4. Reference the ADR in related code comments
