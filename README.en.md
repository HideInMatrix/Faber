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
- **Multiple connection options**: use Cloudflare Tunnel, an external URL, or other network providers to connect compatible web MCP clients with OAuth authorization.
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
3. For the browser channel, expand **Browser connection**, enter the local endpoint of a separate Chromium browser with debugging enabled and the allowed websites, then save. Saving does not launch the browser.
4. Start Runtime and call the tools through an authorized MCP client. Control actions follow your current approval policy.

Enabling Computer Use does not automatically start Runtime or a tunnel. Stop Runtime before changing the toggle or browser configuration.

## Interface language

The interface defaults to Chinese. Choose **English** from the language dropdown at the bottom of the sidebar menu. Your choice is remembered on this computer. Changing the language does not start or stop Runtime, or change your working directory, credentials, or approval settings.

Only interface text is localized. Logs, third-party responses, and your input remain unchanged.

## Open-source acknowledgments

- [Pi Agent](https://github.com/earendil-works/pi)
