# Security

Token Leak Finder runs locally, reads logs/configuration without modifying them, and never sends data. Reports contain aggregate metadata; use `--redact` and inspect artifacts before sharing. No redaction heuristic guarantees removal of every sensitive identifier.

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/RomeoJuliett/token-leak-finder/security/advisories/new). If private reporting is unavailable, open an issue requesting a private contact without including vulnerability details or sensitive data. Never attach raw logs, credentials, config values, or private reports. A synthetic reproduction and affected tool/Node/OS versions are enough to begin investigation.

The current 0.1.x release line is the supported security target. Maintainers should enable private vulnerability reporting before launch.
