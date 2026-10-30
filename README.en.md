# Faber

English · [简体中文](README.md)

Faber, Latin for “craftsman,” helps AI move beyond conversation and get real work done.

## What it does

Connect a web-based AI to local tools through MCP: **the web AI handles reasoning, while Pi Agent executes locally.** Faber does not run a local model.

- **Files and commands**: read and write files in your working directory and run shell commands according to your approval settings.
- **Extensions**: add MCP services and Skills through the Pi plugin system.
- **Public connectivity**: connect web MCP clients through Cloudflare Tunnel or other network providers, with OAuth authentication and tool approvals.

Opening the app only loads settings. MCP and the tunnel run only after you click **Start**.

## Features

- **Web AI, local execution**: connect web AI reasoning to local files, commands, and tools through MCP, without deploying a local model.
- **Computer Use**: built-in desktop and browser control lets AI operate your computer after you enable it and grant the required system permissions.
- **Flexible extensions**: manage MCP services, Skills, and Pi plugins to assemble the tools each task needs.
- **Multiple connection options**: use Cloudflare Tunnel, ngrok, FRP, or Tailscale Funnel to connect compatible web MCP clients with OAuth authorization.
- **Configurable approvals**: choose approval for each request, automatic file-change approval, or full access. You control when Runtime starts and stops, with status and logs available in the app.
- **Ready to use, bilingual interface**: macOS and Windows installers bundle runtime dependencies, with Chinese/English switching, automatic update checks, and manual installation confirmation.

## Installation

Download the **installer** for your computer from [GitHub Releases](https://github.com/HideInMatrix/Faber/releases/latest):

| Platform | Download and install |
| --- | --- |
| macOS · Apple Silicon (M series) | Download `aarch64.dmg`, open it, and drag the app to Applications. |
| macOS · Intel | Download `x64.dmg`, open it, and drag the app to Applications. |
| Windows · x64 | Download `*-setup.exe` or `.msi` and run the installer. |

You do not need to install Node.js, Rust, or Python separately. The Cloudflare client is bundled. Linux desktop builds are not currently supported.

Getting started:

1. Open the app, configure your working directory, OAuth password, and network provider, then save and click **Start**.
2. Add the displayed MCP URL to a web MCP client that supports CIMD OAuth and complete authorization.

macOS installers use a long-lived self-signed certificate and are not notarized by Apple. Windows installers are not Authenticode-signed. If your system blocks the app, verify the download source before following the system’s instructions to allow it to run.

The app checks for updates automatically; confirm installation on the **About** page. `.app.tar.gz`, `latest.json`, and checksum files are for updates or verification, not first-time installation.

## Computer Use

Go beyond reading and writing files: let AI operate your desktop and browser through built-in Computer Use.

1. Stop Runtime and enable **Computer Use** on the **Plugins** page.
2. On macOS, click **Configure permissions**, follow the prompts to grant Accessibility and Screen Recording permissions, then recheck the permission status. On Windows, use an interactive desktop session.
3. For the browser channel, expand **Browser connection** and choose a managed separate window (installed Chrome / Edge, or separately prepared Playwright Chromium), then enter a dedicated session name and allowed websites. Existing CDP attach mode remains available. Managed mode keeps dedicated sign-in data in private application storage, not your everyday browser profile. Its window launches only on explicit browser discovery and approval; saving settings or starting Runtime does not launch it.
4. Start Runtime and call the tools through an authorized MCP client. Control actions follow your current approval policy.

Enabling Computer Use does not automatically start Runtime or a tunnel. Stop Runtime before changing the toggle or browser configuration.

## Importing Skills

Stop Runtime, open **Plugins → Skills → Add Skill**, select a local directory or `SKILL.md`, then scan and select the documents to import. Each document gets an independent configuration: its ID defaults to the folder name, while the Skill keeps its document's `name`. Each can be toggled or removed separately; a single source ID for the entire root directory is no longer required.

Already configured files (including disabled entries) are skipped, and conflicting Skill names are marked in the preview. Compatibility warnings do not block other documents. Existing directory sources offer **Split directory**: confirmation replaces that reference with the selected independent entries; cancelling leaves it unchanged. Import only saves file references: it does not copy, delete or execute original files, or automatically load unconfigured global directories.

## Interface language

The interface defaults to Chinese. Choose **English** from the language dropdown at the bottom of the sidebar menu. Your choice is remembered on this computer. Changing the language does not start or stop Runtime, or change your working directory, credentials, or approval settings.

Only interface text is localized. Logs, third-party responses, and your input remain unchanged.

## Open-source acknowledgments

- [Pi Agent](https://github.com/earendil-works/pi)

### Networking and startup diagnostics

Faber no longer provides application-level HTTP proxy settings, proxy health routes or an authorization connection test. Tunnels, authorization metadata and public health checks use their respective default network paths. System routing and the user's proxy rules determine the actual egress. Enabling a system HTTP proxy does not guarantee that cloudflared or Node.js requests use it; configure routing and DNS rules in the proxy client when using TUN.

Startup errors identify the failed stage. Cloudflare diagnostics distinguish credential rejection, Fake-IP, DNS, certificate validation, TLS handshake and connectivity failures. HTTP/2 uses TCP 7844; QUIC uses UDP 7844. Check the selected protocol and its network path rather than treating one failed TCP/UDP pre-check as proof that both protocols are unavailable.

A connected tunnel followed by failed public service validation points to a later stage: check the public domain, origin forwarding address and port, access policies, or an old service instance. Details are retained in runtime logs. Individual health checks still have a 10-second deadline, with a 30-second interval while running.

Legacy `outbound_proxy`, `health_route` and their environment variables are ignored; saving removes the old fields. External URL remains removed. Old presets load as an unstarted Cloudflare Quick Tunnel draft, clearing their former public URL and provider-specific options without rewriting the original file until saved. Public tunnels still require an OAuth password or static token.

### Development directories

- `scripts/`: build, packaging, publication and release validation tools.
- `diagnostics/`: manually invoked troubleshooting tools and investigation notes.
- `tests/`: local-only automated tests, ignored by Git. Test results and collected evidence are not committed either.

`npm run check` runs type checks, the frontend build and distribution boundary validation without local test files. Developers who retain the local tests can use `npm run test:local`, which builds the service before running them. Fresh clones do not include the tests directory. CI retains build, release provenance, signing, distribution boundary and vulnerability checks, without running local-only tests.

The root and `apps/daemon` pin the same Computer Use version so npm applies the Zod security override across workspace dependencies. Update both pins when upgrading the package; source boundary validation checks that they agree.
