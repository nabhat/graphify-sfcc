# `graphify-sfcc` Installation & Setup Guide

A complete step-by-step guide to installing, configuring, and using `graphify-sfcc` as a global CLI tool and Model Context Protocol (MCP) server for Salesforce Commerce Cloud (SFCC/SFRA) repositories.

---

## Prerequisites

- **Node.js**: Version **≥ 20.0.0** (Verify with `node -v`)
- **npm**: Version **≥ 9.0.0** (Verify with `npm -v`)
- **Operating System**: macOS, Linux, or Windows (PowerShell/WSL)

---

## Installation Options

### Option 1: Global Installation via npm (Recommended)

To install `graphify-sfcc` globally so the `graphify-sfcc` and `sfcc-graph` commands are immediately available in your terminal's `PATH`:

```bash
npm install -g graphify-sfcc
```

Verify installation:

```bash
graphify-sfcc --version
# Output: 0.1.0
```

---

### Option 2: Install from Source / Local Checkout

If you are cloning this repository or working on custom modifications:

```bash
git clone https://github.com/nabhat/graphify-sfcc.git
cd graphify-sfcc
npm install
npm run build
npm install -g .
```

---

### Option 3: Run without Global Installation (npx)

You can also run commands directly via `npx`:

```bash
npx graphify-sfcc --help
npx graphify-sfcc build
```

---

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `SFCC_GRAPH_ROOT` | Absolute path to the SFCC/SFRA target repository root to index. | `CLAUDE_PROJECT_DIR` if set, otherwise current working directory (`process.cwd()`). |
| `SFCC_GRAPH_CARTRIDGE_PATH` | Colon or semicolon-delimited cartridge path order override. | Read automatically from `dw.json` (`cartridgesPath`). |
| `SFCC_GRAPH_CACHE` | Directory path where graph index files are cached on disk. | `<target-repo-root>/.sfcc-graph-cache/` |

---

## AI Assistant Setup & Configuration

`graphify-sfcc` runs over standard input/output (`stdio`) using the Model Context Protocol (MCP).

### 1. Claude Code CLI

Add the MCP server directly to Claude Code using `claude mcp add`:

```bash
claude mcp add graphify-sfcc -- graphify-sfcc serve
```

Or set the target repository explicitly:

```bash
claude mcp add graphify-sfcc -e SFCC_GRAPH_ROOT=/absolute/path/to/your/sfcc-storefront -- graphify-sfcc serve
```

---

### 2. Claude Desktop

Add the following block to your `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "graphify-sfcc": {
      "command": "graphify-sfcc",
      "args": ["serve"],
      "env": {
        "SFCC_GRAPH_ROOT": "/absolute/path/to/your/sfcc-storefront"
      }
    }
  }
}
```

---

### 3. Cursor

Create or edit `.cursor/mcp.json` in your SFCC workspace directory:

```json
{
  "mcpServers": {
    "graphify-sfcc": {
      "command": "graphify-sfcc",
      "args": ["serve"],
      "env": {
        "SFCC_GRAPH_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

---

### 4. Gemini CLI & Antigravity

In your project root or global config (`~/.gemini/config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "graphify-sfcc": {
      "command": "graphify-sfcc",
      "args": ["serve"],
      "env": {
        "SFCC_GRAPH_ROOT": "/absolute/path/to/your/sfcc-storefront"
      }
    }
  }
}
```

---

### 5. Windsurf / VS Code (Cline / Roo Code)

In your workspace `.mcp.json` or Cline configuration:

```json
{
  "mcpServers": {
    "graphify-sfcc": {
      "command": "graphify-sfcc",
      "args": ["serve"]
    }
  }
}
```

---

## CLI Commands Overview

### `graphify-sfcc build`
Index the target codebase and output file, node, and edge statistics:

```bash
graphify-sfcc build
```

### `graphify-sfcc visualize`
Generate an interactive, standalone HTML network graph visualization and open it in your default web browser:

```bash
graphify-sfcc visualize
```

To generate the HTML file without automatically opening the browser:

```bash
graphify-sfcc visualize --no-open
```

### `graphify-sfcc install`
Install the Claude agent skill (`.claude/skills/sfcc-graph/SKILL.md`) into your SFCC project workspace:

```bash
graphify-sfcc install --project
```

---

## Troubleshooting & FAQ

### 1. `graphify-sfcc: command not found`
Ensure your npm global binary directory is in your shell's `PATH`:
- Run `npm bin -g` or `npm prefix -g` to check where global binaries are installed.
- Add `export PATH="$(npm prefix -g)/bin:$PATH"` to your `~/.bashrc` or `~/.zshrc`.

### 2. Cartridges are missing or resolving incorrectly
- Ensure your SFCC project root contains `dw.json` with a valid `cartridgesPath` property (e.g., `"cartridgesPath": "app_custom:app_storefront_base"`).
- Alternatively, export `SFCC_GRAPH_CARTRIDGE_PATH="app_custom:app_storefront_base"`.

### 3. Re-indexing after code edits
Run `build_index` tool call in your AI assistant or run `graphify-sfcc build` in your terminal to refresh cached graph files in `.sfcc-graph-cache/`.
