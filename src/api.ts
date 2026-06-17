import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

/**
 * Streams the tutor explanation for the given message body via SSE.
 * Yields text chunks as they arrive from the backend.
 * @param body - The user message (code + question)
 * @param description - Optional exercise description from preceding markdown cells
 */
export async function* streamExplanation(
  body: string,
  description?: string,
  signal?: AbortSignal
): AsyncGenerator<string, void, undefined> {
  const settings = ServerConnection.makeSettings();
  const url = URLExt.join(settings.baseUrl, 'api/jupyter-ai-tutor/explain');

  const response = await ServerConnection.makeRequest(
    url,
    {
      method: 'POST',
      body: JSON.stringify({ body, description }),
      headers: { 'Content-Type': 'application/json' },
      signal
    },
    settings
  );

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        let parsed: { text?: string; error?: string };
        try {
          parsed = JSON.parse(data) as { text?: string; error?: string };
        } catch {
          continue;
        }

        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) yield parsed.text;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
