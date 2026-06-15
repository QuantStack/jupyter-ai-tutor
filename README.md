# jupyter_ai_tutor

[![Github Actions Status](https://github.com/QuantStack/jupyter-ai-tutor/workflows/Build/badge.svg)](https://github.com/QuantStack/jupyter-ai-tutor/actions/workflows/build.yml)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/QuantStack/jupyter-ai-tutor/main?urlpath=lab)

A JupyterLab extension to add an AI-powered tutor assistant to Notebooks.

[a screencast showing an example with jupyter-ai-tutor]('https://github.com/user-attachments/assets/0f7da09e-fa19-4655-9825-09fdca764859')

It currently relies on [jupyter-ai-jupyternaut](https://github.com/jupyter-ai-contrib/jupyter-ai-jupyternaut) for the agent, it needs to be installed (`pip install jupyter_ai_tutor[server]`).

Once Jupyterlab started, the model must be configured via the menu `Settings>Jupyternaut settings` (model and API key).

## Requirements

- JupyterLab >= 4.0.0
- jupyter-ai-jupyternaut (currently the only agent compatible)

## Install

To install the extension, execute:

```bash
pip install jupyter_ai_tutor[server]
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyter_ai_tutor
```

## Contributing

If you would like to contribute to this extension, please refer to the [Contributing Guide](CONTRIBUTING.md).

## AI Coding Assistant Support

This project includes an `AGENTS.md` file with coding standards and best practices for JupyterLab extension development. The file follows the [AGENTS.md standard](https://agents.md) for cross-tool compatibility.

### Compatible AI Tools

`AGENTS.md` works with AI coding assistants that support the standard, including Cursor, GitHub Copilot, Windsurf, Aider, and others. For a current list of compatible tools, see [the AGENTS.md standard](https://agents.md).
This project also includes symlinks for tool-specific compatibility:

- `CLAUDE.md` → `AGENTS.md` (for Claude Code)

- `GEMINI.md` → `AGENTS.md` (for Gemini Code Assist)

Other conventions you might encounter:

- `.cursorrules` - Cursor's YAML/JSON format (Cursor also supports AGENTS.md natively)
- `CONVENTIONS.md` / `CONTRIBUTING.md` - For CodeConventions.ai and GitHub bots
- Project-specific rules in JetBrains AI Assistant settings

All tool-specific files should be symlinks to `AGENTS.md` as the single source of truth.

### What's Included

The `AGENTS.md` file provides guidance on:

- Code quality rules and file-scoped validation commands
- Naming conventions for packages, plugins, and files
- Coding standards (TypeScript)
- Development workflow and debugging
- Common pitfalls and how to avoid them

### Customization

You can edit `AGENTS.md` to add project-specific conventions or adjust guidelines to match your team's practices. The file uses plain Markdown with Do/Don't patterns and references to actual project files.

**Note**: `AGENTS.md` is living documentation. Update it when you change conventions, add dependencies, or discover new patterns. Include `AGENTS.md` updates in commits that modify workflows or coding standards.
