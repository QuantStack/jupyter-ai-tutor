import {
  AbstractChatModel,
  IAttachment,
  IChatContext,
  IChatModel,
  IMessageContent,
  INewMessage,
  IUser
} from '@jupyter/chat';
import { Contents } from '@jupyterlab/services';
import { UUID } from '@lumino/coreutils';

import { fetchDefaultSystemPrompt, streamExplanation } from './api';
import { AI_AVATAR } from './icons';
import { findTutorMd } from './tutorMd';

export interface ITutorNewMessage extends INewMessage {
  attachments?: IAttachment[];
  notebookPath?: string;
  formattedBody?: string;
  action?: 'explain' | 'review';
}

export const TUTOR_USER: IUser = {
  username: 'tutor',
  display_name: 'Tutor',
  initials: 'T',
  bot: true,
  avatar_url: AI_AVATAR
};

export interface ITutorChatContext extends IChatContext {
  /**
   * The stop streaming callback.
   */
  stopStreaming: () => void;
  /**
   * The clear messages callback.
   */
  clearMessages: () => Promise<void>;
}

/**
 * Chat model for the AI tutor panel.
 * Routes messages to the tutor backend and streams responses into the chat.
 */
export class TutorChatModel extends AbstractChatModel {
  private _abortController: AbortController | null = null;
  private _contents: Contents.IManager;
  private _defaultSystemPrompt: string | null = null;
  private _discoverTutorMd: boolean;

  constructor(options: TutorChatModel.IOptions) {
    super(options);
    this._contents = options.contents;
    this._discoverTutorMd = options.discoverTutorMd ?? true;
    this.name = 'Tutor';
    this.setReady(UUID.uuid4());
  }

  get user(): IUser {
    return { username: 'user', display_name: 'You' };
  }

  sendMessage(message: ITutorNewMessage): string {
    const userMsg: IMessageContent = {
      type: 'msg',
      id: UUID.uuid4(),
      time: Date.now() / 1000,
      body: message.body ?? '',
      sender: this.user,
      attachments: message.attachments
    };
    this.messageAdded(userMsg);
    return userMsg.id;
  }

  async sendMessageToAI(message: ITutorNewMessage): Promise<void> {
    if (!message.body?.trim()) return;

    this.sendMessage(message);

    this.updateWriters([{ user: TUTOR_USER }]);

    // Add an initial empty tutor message slightly later to preserve order.
    const tutorMsgContent: IMessageContent = {
      type: 'msg',
      id: UUID.uuid4(),
      time: Date.now() / 1000 + 0.001,
      body: '',
      sender: TUTOR_USER
    };
    this.messageAdded(tutorMsgContent);

    const streamingMsg = this.messages[this.messages.length - 1];
    this._abortController = new AbortController();

    try {
      const signal = this._abortController.signal;
      const systemPrompt = await this._getSystemPrompt(
        message.notebookPath,
        signal
      );
      let accumulated = '';
      for await (const chunk of streamExplanation(
        {
          systemPrompt,
          prompt: message.formattedBody ?? message.body,
          action: message.action
        },
        signal
      )) {
        accumulated += chunk;
        streamingMsg.update({ body: accumulated });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errorText = err instanceof Error ? err.message : String(err);
      streamingMsg.update({
        body: `Sorry, an error occurred: ${errorText}`
      });
      console.error('Tutor explanation failed:', err);
    } finally {
      this._abortController = null;
      this.updateWriters([]);
    }
  }

  createChatContext(): ITutorChatContext {
    return {
      name: this.name,
      id: this.id ?? '',
      user: this.user,
      users: [],
      messages: this.messages,
      stopStreaming: () => this.stopStreaming(),
      clearMessages: () => this.clearMessages()
    };
  }

  stopStreaming = (): void => {
    this._abortController?.abort();
  };

  /**
   * Clears all messages from the chat and resets conversation state.
   */
  clearMessages = async (): Promise<void> => {
    this.stopStreaming();
    this.messagesDeleted(0, this.messages.length);
  };

  /**
   * Returns the system prompt to use for a notebook: the closest TUTOR.md in
   * the file tree if any, otherwise the server default.
   * @param notebookPath - Path of the notebook, as understood by the contents manager
   * @param signal - Optional abort signal for the server request
   */
  private async _getSystemPrompt(
    notebookPath: string | undefined,
    signal?: AbortSignal
  ): Promise<string> {
    if (this._discoverTutorMd && notebookPath) {
      const tutorMd = await findTutorMd(this._contents, notebookPath);
      if (tutorMd) {
        return tutorMd.content;
      }
    }
    // The server default does not change while the server is running.
    if (this._defaultSystemPrompt === null) {
      this._defaultSystemPrompt = await fetchDefaultSystemPrompt(signal);
    }
    return this._defaultSystemPrompt;
  }
}

export namespace TutorChatModel {
  /**
   * The tutor chat model options.
   */
  export interface IOptions extends IChatModel.IOptions {
    /**
     * The contents manager used to look for TUTOR.md files.
     */
    contents: Contents.IManager;
    /**
     * Whether to look for a TUTOR.md file in the file tree, walking up from the
     * notebook directory, before falling back on the server default.
     * Defaults to true.
     */
    discoverTutorMd?: boolean;
  }
}
