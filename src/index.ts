import { IChatTracker } from '@jupyter/chat';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { infoIcon } from '@jupyterlab/ui-components';

/**
 * Command IDs used by the jupyter-ai-tutor extension.
 */
namespace CommandIDs {
  export const explainCode = 'jupyter-ai-tutor:explain-code';
}

/**
 * Initialization data for the jupyter-ai-tutor extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyter-ai-tutor:plugin',
  description:
    'A JupyterLab extension to add an AI-powered tutor assistant to Notebooks.',
  autoStart: true,
  optional: [ISettingRegistry, IChatTracker, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null,
    chatTracker: IChatTracker | null,
    translator: ITranslator | null
  ) => {
    const { commands } = app;
    const trans = (translator ?? nullTranslator).load('jupyterlab');

    // Register the command to explain code in active cell
    commands.addCommand(CommandIDs.explainCode, {
      label: trans.__('Explain Code'),
      caption: trans.__('Send cell content to AI chat for explanation'),
      icon: infoIcon,
      isEnabled: () =>
        !!chatTracker?.currentWidget?.model?.activeCellManager?.available,
      isVisible: () => true,
      execute: async () => {
        if (!chatTracker) {
          return;
        }

        const chat = chatTracker.currentWidget;
        if (!chat) {
          console.warn('No active chat found to send message');
          return;
        }

        const { activeCellManager, selectionWatcher } = chat.model;

        let source = '';
        let language: string | undefined;

        if (selectionWatcher?.selection) {
          source = selectionWatcher.selection.text;
          language = selectionWatcher.selection.language;
        } else if (activeCellManager?.available) {
          const content = activeCellManager.getContent(false);
          if (content) {
            source = content.source;
            language = content.language;
          }
        }

        if (!source.trim()) {
          return;
        }

        const body = `Can you explain this code?\n\n\`\`\`${language ?? ''}\n${source}\n\`\`\`\n`;
        await chat.model.sendMessage({ body });
        chat.activate();
      },
      describedBy: {
        args: {
          type: 'object',
          properties: {}
        }
      }
    });

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(_settings => {
          // Settings loaded — add any config-driven initialization here.
        })
        .catch(reason => {
          console.error(
            'Failed to load settings for jupyter-ai-tutor.',
            reason
          );
        });
    }

    console.log('JupyterLab extension jupyter-ai-tutor is activated!');
  }
};

export default plugin;
