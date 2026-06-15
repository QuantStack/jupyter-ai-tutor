from pathlib import Path

from jupyter_server.extension.application import ExtensionApp
from traitlets import Unicode

from .handlers import ExplainHandler

_DEFAULT_AGENT_MD = Path(__file__).parent / "AGENT.md"


class JupyterAITutorApp(ExtensionApp):
    name = "jupyter_ai_tutor"
    app_name = "Jupyter AI Tutor"

    agent_md = Unicode(
        default_value="",
        help=(
            "Path to a Markdown file used as the system prompt. "
            "Defaults to the built-in AGENT.md shipped with the extension."
        ),
    ).tag(config=True)

    def initialize_settings(self):
        path = Path(self.agent_md) if self.agent_md else _DEFAULT_AGENT_MD
        self.settings["jupyter_ai_tutor.system_prompt"] = path.read_text(
            encoding="utf-8"
        ).strip()
        self.log.info("jupyter_ai_tutor: loaded system prompt from %s", path)

    def initialize_handlers(self):
        self.handlers = [
            (r"/api/jupyter-ai-tutor/explain", ExplainHandler),
        ]
