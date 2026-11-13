import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

/**
 * The default system prompt configured on the server.
 */
interface IDefaultSystemPrompt {
  /**
   * The system prompt content.
   */
  content: string;
}

/**
 * Type guard for the default system prompt server response.
 */
function isDefaultSystemPrompt(value: unknown): value is IDefaultSystemPrompt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return typeof (value as Record<string, unknown>).content === 'string';
}

/**
 * Fetches the default system prompt configured on the server (either the
 * configured TUTOR.md or the built-in one).
 * @param signal - Optional abort signal
 */
export async function fetchDefaultSystemPrompt(
  signal?: AbortSignal
): Promise<string> {
  const settings = ServerConnection.makeSettings();
  const url = URLExt.join(settings.baseUrl, 'api/jupyter-ai-tutor/tutor-md');

  const response = await ServerConnection.makeRequest(
    url,
    { method: 'GET', signal },
    settings
  );

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response);
  }

  const data: unknown = await response.json();
  if (!isDefaultSystemPrompt(data)) {
    throw new Error('Unexpected response when fetching the system prompt');
  }
  return data.content;
}

/**
 * The tutor request.
 */
export interface ITutorRequest {
  /**
   * The system prompt.
   */
  systemPrompt: string;
  /**
   * The user prompt.
   */
  prompt: string;
  /**
   * The requested action.
   */
  action?: 'explain' | 'review';
}

/**
 * Streams the tutor answer for the given request via SSE.
 * Yields text chunks as they arrive from the backend.
 * @param request - The system prompt, user prompt and action
 * @param signal - Optional abort signal
 */
export async function* streamExplanation(
  request: ITutorRequest,
  signal?: AbortSignal
): AsyncGenerator<string, void, undefined> {
  const settings = ServerConnection.makeSettings();
  const url = URLExt.join(settings.baseUrl, 'api/jupyter-ai-tutor/explain');

  const response = await ServerConnection.makeRequest(
    url,
    {
      method: 'POST',
      body: JSON.stringify({
        body: request.prompt,
        systemPrompt: request.systemPrompt,
        action: request.action ?? 'explain'
      }),
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
