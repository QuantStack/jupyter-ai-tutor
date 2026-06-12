import { ChatWidget } from '@jupyter/chat';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { infoIcon } from '@jupyterlab/ui-components';

import { TutorChatModel } from './model';

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
  requires: [IRenderMimeRegistry],
  optional: [ISettingRegistry, INotebookTracker, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    rmRegistry: IRenderMimeRegistry,
    settingRegistry: ISettingRegistry | null,
    notebookTracker: INotebookTracker | null,
    translator: ITranslator | null
  ) => {
    const { commands } = app;
    const trans = (translator ?? nullTranslator).load('jupyterlab');

    const tutorModel = new TutorChatModel({
      id: 'jupyter-ai-tutor',
      translator: translator ?? undefined
    });
    const chatWidget = new ChatWidget({
      model: tutorModel,
      rmRegistry,
      translator: translator ?? undefined,
      welcomeMessage: trans.__(
        'Select a code cell and click **Explain Code** to get started, or type a question below.'
      )
    });
    chatWidget.id = 'jupyter-ai-tutor-panel';
    chatWidget.title.label = trans.__('Tutor');
    chatWidget.title.caption = trans.__('Tutor');
    chatWidget.title.closable = true;
    app.shell.add(chatWidget, 'right');

    // Keep the enabled state in sync when the active cell changes.
    notebookTracker?.activeCellChanged.connect(() => {
      commands.notifyCommandChanged(CommandIDs.explainCode);
    });

    commands.addCommand(CommandIDs.explainCode, {
      label: trans.__('Explain Code'),
      caption: trans.__('Send cell content to AI tutor for explanation'),
      icon: infoIcon,
      isEnabled: () => {
        const cell = notebookTracker?.activeCell;
        return !!cell && cell.model.type === 'code';
      },
      isVisible: () => true,
      execute: async () => {
        const cell = notebookTracker?.activeCell;
        if (!cell || cell.model.type !== 'code') return;

        const source = cell.model.sharedModel.source.trim();
        if (!source) return;

        const language =
          notebookTracker?.currentWidget?.model?.defaultKernelLanguage ?? '';
        const body = `Can you explain this code?\n\n\`\`\`${language}\n${source}\n\`\`\`\n`;

        if (!chatWidget.isAttached) {
          app.shell.add(chatWidget, 'right');
        }
        app.shell.activateById(chatWidget.id);

        await tutorModel.sendMessageToAI({ body });
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
          // Settings loaded.
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
