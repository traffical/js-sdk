# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the Traffical SDK, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email security@traffical.io with details
3. Include steps to reproduce if possible

We will acknowledge your report within 48 hours and provide a timeline for a fix.

## Supported Versions

Security fixes are applied to the latest published minor of each package. The
packages are versioned independently; the ranges below track the current
`0.x` line of each.

| Package                 | Supported          |
| ----------------------- | ------------------ |
| `@traffical/core`       | :white_check_mark: (latest 0.x) |
| `@traffical/core-io`    | :white_check_mark: (latest 0.x) |
| `@traffical/js-client`  | :white_check_mark: (latest 0.x) |
| `@traffical/node`       | :white_check_mark: (latest 0.x) |
| Older 0.x minors        | :x:                |

While the SDKs are pre-1.0, only the most recent published minor of each
package receives security updates; upgrade to the latest release to stay
supported.

## Security Best Practices

When using the Traffical SDK:

- Never expose API keys in client-side code (use public keys for browser SDKs)
- Keep dependencies updated
- Use environment variables for sensitive configuration

