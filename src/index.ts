import { ChatWidget } from '@jupyter/chat';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICodeCellModel } from '@jupyterlab/cells';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { infoIcon } from '@jupyterlab/ui-components';

import { TutorChatModel } from './model';

const INFO_ICON_BASE_64 = btoa(infoIcon.svgstr);

// Matches ANSI escape sequences used for terminal colors in tracebacks.
const ANSI_ESCAPE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`,
  'g'
);

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
        `## Select a code cell and click **Explain Code** <img src="data:image/svg+xml;base64,${INFO_ICON_BASE_64}" /> to get started.`
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

        // Collect the first error output from the cell, if any.
        const codeModel = cell.model as ICodeCellModel;
        const outputs = codeModel.outputs;
        let errorSection = '';

        for (let i = 0; i < outputs.length; i++) {
          const output = outputs.get(i);
          if (output.type === 'error') {
            const json = output.toJSON() as {
              ename: string;
              evalue: string;
              traceback: string[];
            };
            const traceback = json.traceback
              .map(line => line.replace(ANSI_ESCAPE, ''))
              .join('\n');
            errorSection =
              `\n\n**Error:**\n\`\`\`\n${json.ename}: ${json.evalue}\n` +
              `${traceback}\n\`\`\``;
            break;
          }
        }

        const question = errorSection
          ? 'Can you explain this code and the error it produced?'
          : 'Can you explain this code?';
        const body = `${question}\n\n\`\`\`${language}\n${source}\n\`\`\`${errorSection}\n`;

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
