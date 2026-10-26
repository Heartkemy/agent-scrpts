# Security policy

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/Heartkemy/agent-scrpts/security/advisories/new).
Do not disclose proof-of-concept details, credentials, private task data, or
local configuration in public issues.

The supported branch is `main`.

This project intentionally keeps its HTTP runtime loopback-only, token-authenticated,
and hostile to browser origins. Changes to authentication, host/origin validation,
model checksums, or service management need focused tests.
