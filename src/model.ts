import {
  AbstractChatModel,
  IAttachment,
  IChatContext,
  IChatModel,
  IMessageContent,
  INewMessage,
  IUser
} from '@jupyter/chat';
import { UUID } from '@lumino/coreutils';

import { streamExplanation } from './api';
import { AI_AVATAR } from './icons';

interface ITutorNewMessage extends INewMessage {
  attachments?: IAttachment[];
  cellId?: string;
  notebookPath?: string;
  formattedBody?: string;
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

  constructor(options?: IChatModel.IOptions) {
    super(options);
    this.name = 'Tutor';
    this.setReady();
  }

  get user(): IUser {
    return { username: 'user', display_name: 'You' };
  }

  sendMessage(message: ITutorNewMessage): void {
    const userMsg: IMessageContent = {
      type: 'msg',
      id: UUID.uuid4(),
      time: Date.now() / 1000,
      body: message.body,
      sender: this.user,
      attachments: message.attachments
    };
    this.messageAdded(userMsg);
  }

  async sendMessageToAI(message: ITutorNewMessage): Promise<void> {
    if (!message.body.trim()) return;

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
      let accumulated = '';
      for await (const chunk of streamExplanation(
        message.formattedBody ?? message.body,
        message.notebookPath,
        this._abortController.signal
      )) {
        accumulated += chunk;
        streamingMsg.update({ body: accumulated });
      }
      if (message.cellId) {
        accumulated += `\n\n[Go to Cell](#tutor-cell-${message.cellId})`;
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
}
