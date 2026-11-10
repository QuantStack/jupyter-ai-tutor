from pathlib import Path

from jupyter_server.extension.application import ExtensionApp
from traitlets import Bool, Unicode

from .handlers import ExplainHandler, TutorMdHandler

_DEFAULT_TUTOR_MD = Path(__file__).parent / "TUTOR.md"

# Page config key exposing the 'discover_tutor_md' option to the frontend.
PAGE_CONFIG_DISCOVER_TUTOR_MD = "jupyterAiTutorDiscoverTutorMd"


class JupyterAITutorApp(ExtensionApp):
    name = "jupyter_ai_tutor"
    app_name = "Jupyter AI Tutor"

    discover_tutor_md = Bool(
        default_value=True,
        help=(
            "If True, look for a TUTOR.md file in the notebook's directory and "
            "parent directories up to the server root. The first one found takes "
            "precedence over the configured system prompt."
        ),
    ).tag(config=True)

    tutor_md = Unicode(
        default_value="",
        help=(
            "Path to a Markdown file used as the system prompt. "
            "Defaults to the built-in TUTOR.md shipped with the extension."
        ),
    ).tag(config=True)

    debug = Bool(
        default_value=False,
        help="Whether to log prompts and replies to /tmp for debugging.",
    ).tag(config=True)

    def initialize_settings(self):
        path = Path(self.tutor_md) if self.tutor_md else _DEFAULT_TUTOR_MD
        self.settings["jupyter_ai_tutor.default_system_prompt"] = path.read_text(
            encoding="utf-8"
        ).strip()
        self.settings["jupyter_ai_tutor.debug"] = self.debug
        # Expose the discovery option to the frontend. The page config values are
        # read as strings by the frontend, hence the explicit string conversion.
        page_config = self.settings.setdefault("page_config_data", {})
        page_config[PAGE_CONFIG_DISCOVER_TUTOR_MD] = str(self.discover_tutor_md).lower()
        self.log.info("jupyter_ai_tutor: loaded system prompt from %s (debug=%s)", path, self.debug)


    def initialize_handlers(self):
        self.handlers = [
            (r"/api/jupyter-ai-tutor/explain", ExplainHandler),
            (r"/api/jupyter-ai-tutor/tutor-md", TutorMdHandler),
        ]
