import {
  AbstractChatContext,
  AbstractChatModel,
  IChatContext,
  IChatModel,
  IMessageContent,
  INewMessage,
  IUser
} from '@jupyter/chat';
import { UUID } from '@lumino/coreutils';

import { streamExplanation } from './api';
import { AI_AVATAR } from './icons';

const TUTOR_USER: IUser = {
  username: 'tutor',
  display_name: 'Tutor',
  initials: 'T',
  bot: true,
  avatar_url: AI_AVATAR
};

class TutorChatContext extends AbstractChatContext {
  get users(): IUser[] {
    const users = new Map<string, IUser>();
    for (const msg of this._model.messages) {
      users.set(msg.sender.username, msg.sender);
    }
    return Array.from(users.values());
  }
}

/**
 * Chat model for the AI tutor panel.
 * Routes messages to the tutor backend and streams responses into the chat.
 */
export class TutorChatModel extends AbstractChatModel {
  constructor(options?: IChatModel.IOptions) {
    super(options);
    this.name = 'Tutor';
    this.setReady();
  }

  get user(): IUser | undefined {
    return undefined;
  }

  sendMessage(message: INewMessage): void {
    const userMsg: IMessageContent = {
      type: 'msg',
      id: UUID.uuid4(),
      time: Date.now() / 1000,
      body: message.body,
      sender: this.user ?? { username: 'user', display_name: 'You' }
    };
    this.messageAdded(userMsg);
  }

  async sendMessageToAI(message: INewMessage): Promise<void> {
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

    try {
      let accumulated = '';
      for await (const chunk of streamExplanation(message.body)) {
        accumulated += chunk;
        streamingMsg.update({ body: accumulated });
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      streamingMsg.update({
        body: `Sorry, an error occurred: ${errorText}`
      });
      console.error('Tutor explanation failed:', err);
    } finally {
      this.updateWriters([]);
    }
  }

  createChatContext(): IChatContext {
    return new TutorChatContext({ model: this });
  }
}
