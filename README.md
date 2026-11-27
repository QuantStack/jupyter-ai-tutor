# jupyter_ai_tutor

[![Github Actions Status](https://github.com/QuantStack/jupyter-ai-tutor/workflows/Build/badge.svg)](https://github.com/QuantStack/jupyter-ai-tutor/actions/workflows/build.yml)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/QuantStack/jupyter-ai-tutor/main?urlpath=lab)

A JupyterLab extension to add an AI-powered tutor assistant to Notebooks.

[a screencast showing an example with jupyter-ai-tutor](https://github.com/user-attachments/assets/0f7da09e-fa19-4655-9825-09fdca764859)

It currently relies on [jupyter-ai-jupyternaut](https://github.com/jupyter-ai-contrib/jupyter-ai-jupyternaut) (<0.1) for the agent, it needs to be installed (`pip install jupyter_ai_tutor[server]`).

Once Jupyterlab started, the model must be configured via the menu `Settings>Jupyternaut settings` (model and API key)
or its [configuration file](#jupyternaut).
See Jupyternaut [documentation](https://jupyter-ai.readthedocs.io/en/v3/users/jupyternaut/index.html#model-selection) for details about setting up the agent.

## How it works

Each code cell in a notebook gets an **Explain Code** button in its toolbar ![info icon](./info.png) \
Clicking it opens a chat panel on the right side and sends the following context to the AI:

- The **cell source code** and its **kernel language**
- Any **error output** produced by the cell (traceback included)
- **Preceding code cells and markdown cell** (up to the previous markdown cell), used as the exercise description
- An optional **reference_solution** (multiline string) and **evaluation_criteria** (multiline string) stored in the cell metadata <!-- (the solution is ROT13-encoded to keep it hidden from students) -->

The AI replies using a configurable **system prompt** (`TUTOR.md`) that shapes its pedagogical behavior. By default the extension looks for a `TUTOR.md` file walking up from the notebook's directory to the server root, so different courses or folders can each have their own tutor persona.

## Configuration

### TUTOR

The extension can be configured via `jupyter_server_config.py` (or any traitlets CLI config):

```python
c.JupyterAITutorApp.discover_tutor_md = True   # default
c.JupyterAITutorApp.tutor_md = ""              # default (uses built-in TUTOR.md)
c.JupyterAITutorApp.debug = False              # default
```

| Parameter           | Type | Default | Description                                                                                                                                                                                                          |
| ------------------- | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover_tutor_md` | bool | `True`  | When enabled, the extension searches for a `TUTOR.md` file starting from the active notebook's directory and walking up to the server root. The first file found takes precedence over the configured system prompt. |
| `tutor_md`          | str  | `""`    | Path to a Markdown file used as the system prompt. When empty, falls back to the built-in `TUTOR.md` shipped with the extension.                                                                                     |
| `debug`             | bool | `False` | When enabled, prompts and model replies are logged to `jupyter-ai-tutor` temp directory for debugging purposes.                                                                                                      |

### Templating

The system prompt and the actions instructions of `TUTOR.md` are [Jinja](https://jinja.palletsprojects.com/en/stable/templates/) templates, rendered each time an action is run with the following variables:

| Variable     | Description                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `notebook`   | The whole notebook, in [nbformat](https://nbformat.readthedocs.io/en/latest/format_description.html) (`cells`, `metadata`...) |
| `cell`       | The cell the action is run on, in nbformat (`cell_type`, `source`, `metadata`, `outputs`...)                                  |
| `cell_index` | The index of the cell in `notebook.cells`                                                                                     |
| `action`     | The id of the action being run (its `scenario`)                                                                               |

For example, to use some cell metadata and the preceding cells:

```jinja
{% if cell.metadata.hint %}
Guide the student toward this hint: {{ cell.metadata.hint }}
{% endif %}

The previous cells of the notebook are:
{% for previous in notebook.cells[:cell_index] %}
- {{ previous.cell_type }}: {{ previous.source }}
{% endfor %}
```

The ANSI escape sequences (terminal colors) are removed from the error outputs tracebacks.

The cell and its context are only sent to the tutor through the templates: the built-in `TUTOR.md` describes them in a `## Request` section (the cell source and error, the preceding cells, and the `initial_source`, `reference_solution` and `evaluation_criteria` cell metadata). A custom `TUTOR.md` should include a similar section, the user message only contains the cell source and error, as displayed in the chat.

Templates are rendered with [@huggingface/jinja](https://github.com/huggingface/huggingface.js/tree/main/packages/jinja), which implements a subset of Jinja, with `trim_blocks` and `lstrip_blocks` enabled.

### Jupyternaut

The default model and API key used with Jupyternaut agent can be setup via `jupyter_server_config.py` (or any traitlets CLI config):

```python
c.AiExtension.initial_language_model=mistral/devstral-latest
c.AiExtension.default_api_keys={'MISTRAL_API_KEY': '***'}
```

It is also possible to configure your custom model directly via the JupyterNaut configuration file
`~/.local/share/jupyter/jupyter_ai/config.json`, for example

```
{
    "model_provider_id": "openai/qwen-3.6-35b-instruct",
    "embeddings_provider_id": null,
    "completions_model_provider_id": null,
    "api_keys": {},
    "send_with_shift_enter": false,
    "fields": {
        "openai/qwen-3.6-35b-instruct": {
            "api_base": "<your custom API base>"
        }
    },
    "embeddings_fields": {},
    "completions_fields": {}
}
```

The related secret (`OPENAI_API_KEY` in that case) should be stored in a `.env` file at the jupyter lab root:

```
OPENAI_API_KEY="<my openai key>"
```

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
