import json
import tempfile
import tornado

from datetime import datetime
from jupyter_server.base.handlers import APIHandler
from pathlib import Path
from tornado.iostream import StreamClosedError

_TUTOR_FILENAME = "TUTOR.md"


class ExplainHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        body = self.get_json_body()
        if not body or "body" not in body:
            raise tornado.web.HTTPError(400, "Missing 'body' field in request")

        message_body = body["body"]
        action = body.get("action", "explain")

        config_manager = self.settings.get("jupyternaut.config_manager")
        if not config_manager:
            raise tornado.web.HTTPError(
                503, "Jupyternaut config manager is not available"
            )
        if not config_manager.chat_model:
            raise tornado.web.HTTPError(
                503,
                "No chat model is configured. Set one in 'Settings > AI Settings'.",
            )
        model_used_string = f"/* MODEL USED: {config_manager.chat_model} (ACTION: {action}) */\n\n"
        
        self.set_header("Content-Type", "text/event-stream")
        self.set_header("Cache-Control", "no-cache")
        self.set_header("X-Accel-Buffering", "no")

        notebook_path = body.get("notebookPath", "")
        server_root = self.settings.get("server_root_dir", "")
        raw_system_prompt = None
        if self.settings.get("jupyter_ai_tutor.discover_tutor_md", True) and notebook_path and server_root:
            raw_system_prompt = self._find_tutor_md(notebook_path, server_root)
            if raw_system_prompt:
                self.log.info(
                    "jupyter_ai_tutor: using TUTOR.md resolved from notebook path %s",
                    notebook_path,
                )
        if raw_system_prompt is None:
            raw_system_prompt = self.settings.get(
                "jupyter_ai_tutor.default_system_prompt", ""
            )

        system_prompt = self._render_prompt_template(
            raw_system_prompt, action, notebook_path, body
        )

        debug_mode = self.settings.get("jupyter_ai_tutor.debug", False)
        prompt_file = None
        answer_file = None
        accumulated_response = model_used_string

        if debug_mode:
            debug_dir = Path(tempfile.gettempdir()) / "jupyter-ai-tutor"
            try:
                debug_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                self.log.error(f"Failed to create debug directory {debug_dir}: {e}")
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            prompt_file = debug_dir / f"{timestamp}_jupyter_tutor_{action}_prompt.txt"
            answer_file = debug_dir / f"{timestamp}_jupyter_tutor_{action}_answer.txt"
            try:
                with prompt_file.open("w", encoding="utf-8") as f:
                    f.write(model_used_string)
                    f.write("=== SYSTEM PROMPT ===\n\n")
                    f.write(system_prompt)
                    f.write("\n\n=== USER MESSAGE ===\n\n")
                    f.write(message_body)
            except Exception as e:
                self.log.error(f"Failed to write tutor debug prompt: {e}")

        try:
            from jupyter_ai_jupyternaut.jupyternaut.chat_models import ChatLiteLLM
            from langchain_core.messages import HumanMessage, SystemMessage

            model = ChatLiteLLM(
                **config_manager.chat_model_args,
                model=config_manager.chat_model,
                streaming=True,
            )

            async for chunk in model.astream(
                [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=message_body),
                ]
            ):
                text = (
                    chunk.content
                    if isinstance(chunk.content, str)
                    else "".join(
                        block.get("text", "")
                        for block in chunk.content
                        if isinstance(block, dict)
                    )
                )
                if text:
                    if debug_mode:
                        accumulated_response += text
                    self.write(f"data: {json.dumps({'text': text})}\n\n")
                    await self.flush()

            if debug_mode and answer_file:
                try:
                    with answer_file.open("w", encoding="utf-8") as f:
                        f.write(accumulated_response)
                        f.write("\n")
                except Exception as e:
                    self.log.error(f"Failed to write tutor debug answer: {e}")

        except StreamClosedError:
            if debug_mode and answer_file and accumulated_response:
                try:
                    with answer_file.open("w", encoding="utf-8") as f:
                        f.write(accumulated_response)
                        f.write("\n")
                except Exception as e:
                    pass
            return  # Client disconnected; stop streaming
        except Exception as e:
            self.log.exception("Error during tutor LLM call")
            try:
                self.write(f"data: {json.dumps({'error': str(e)})}\n\n")
                await self.flush()
            except StreamClosedError:
                return

        try:
            self.write("data: [DONE]\n\n")
            await self.flush()
            self.finish()
        except StreamClosedError:
            pass

    def _render_prompt_template(
        self, raw_prompt: str, action: str, notebook_path: str, body: dict
    ) -> str:
        """Renders the system prompt using Jinja2 template rendering."""
        try:
            from jinja2 import Template

            template = Template(raw_prompt)
            return template.render(
                action=action,
                notebook_path=notebook_path,
                **body,
            ).strip()
        except Exception as e:
            self.log.error(f"jupyter_ai_tutor: Jinja template rendering error: {e}")
            return raw_prompt.strip()

    def _find_tutor_md(self, notebook_path: str, server_root: str) -> str | None:
        """Walk up the directory tree from the notebook's directory toward the
        server root, returning the content of the first TUTOR.md found, or None."""
        root = Path(server_root).expanduser().resolve()
        candidate = (root / notebook_path).resolve().parent
        self.log.debug("jupyter_ai_tutor: searching TUTOR.md from %s up to %s", candidate, root)
        # Stay within the server root.
        try:
            candidate.relative_to(root)
        except ValueError:
            self.log.warning("jupyter_ai_tutor: notebook path %s is outside server root %s", candidate, root)
            return None
        while True:
            tutor_file = candidate / _TUTOR_FILENAME
            self.log.debug("jupyter_ai_tutor: checking %s", tutor_file)
            if tutor_file.is_file():
                return tutor_file.read_text(encoding="utf-8").strip()
            if candidate == root:
                break
            candidate = candidate.parent
        return None