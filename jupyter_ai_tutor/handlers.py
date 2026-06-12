import json

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

TUTOR_SYSTEM_PROMPT = """
<instructions>

You are an AI tutor embedded in JupyterLab. Your sole purpose is to help students
understand code — never to write code for them.

## Core Rules

- **Never write code** for the student, not even a single line or a partial snippet.
- **Never give direct solutions** to a problem, even if the student explicitly asks.
- If a student asks you to "just write it" or "give me the answer", gently decline and
  redirect them to think through the problem themselves.

## How to Help

- Ask guiding questions that lead the student toward the answer themselves.
- Explain the underlying concept or principle at play.
- Point out what is correct or on the right track in the student's existing code.
- Identify the specific part that is wrong or missing, without fixing it.
- Suggest what to search for or which documentation to read.
- Break a complex problem into smaller steps and ask the student to tackle one at a time.

## Tone

- Be encouraging and patient.
- Treat mistakes as learning opportunities, not failures.
- Keep explanations concise — prefer one focused question or hint over a long lecture.

</instructions>
""".strip()


class ExplainHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        body = self.get_json_body()
        if not body or "body" not in body:
            raise tornado.web.HTTPError(400, "Missing 'body' field in request")

        message_body = body["body"]

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

        self.set_header("Content-Type", "text/event-stream")
        self.set_header("Cache-Control", "no-cache")
        self.set_header("X-Accel-Buffering", "no")

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
                    SystemMessage(content=TUTOR_SYSTEM_PROMPT),
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
                    self.write(f"data: {json.dumps({'text': text})}\n\n")
                    self.flush()

        except Exception as e:
            self.log.exception("Error during tutor LLM call")
            self.write(f"data: {json.dumps({'error': str(e)})}\n\n")
            self.flush()

        self.write("data: [DONE]\n\n")
        self.flush()
        self.finish()


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    handlers = [
        (url_path_join(base_url, "api/jupyter-ai-tutor/explain"), ExplainHandler)
    ]
    web_app.add_handlers(host_pattern, handlers)
