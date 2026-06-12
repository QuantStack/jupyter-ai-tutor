try:
    from ._version import __version__
except ImportError:
    import warnings
    warnings.warn("Importing 'jupyter_ai_tutor' outside a proper installation.")
    __version__ = "dev"

from .app import JupyterAITutorApp


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyter-ai-tutor"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyter_ai_tutor", "app": JupyterAITutorApp}]
