import {
  AttachmentOpenerRegistry,
  ChatWidget,
  IAttachment,
  IChatModel,
  INotebookAttachment,
  InputToolbarRegistry
} from '@jupyter/chat';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICodeCellModel } from '@jupyterlab/cells';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { infoIcon } from '@jupyterlab/ui-components';

import { clearItem, stopItem } from './components';
import { TUTOR_USER, TutorChatModel } from './model';
import { decodeRot13, formatEvaluationCriteria, isContinuous } from './utils';

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

    // The input toolbar registry
    const inputToolbarRegistry = InputToolbarRegistry.defaultToolbarRegistry();
    inputToolbarRegistry.hide('send');
    inputToolbarRegistry.addItem('stop', stopItem(trans));
    inputToolbarRegistry.addItem('clear', clearItem(trans));

    // The attachment opener registry.
    const attachmentOpenerRegistry = new AttachmentOpenerRegistry();

    attachmentOpenerRegistry.set('file', (attachment: IAttachment) => {
      app.commands.execute('docmanager:open', { path: attachment.value });
    });

    attachmentOpenerRegistry.set(
      'notebook',
      async (attachment: IAttachment) => {
        // Reveal the notebook.
        const widget = await app.commands.execute('docmanager:open', {
          path: attachment.value
        });

        // Check if cells are attached.
        if (
          widget &&
          attachment.type === 'notebook' &&
          attachment.cells?.length
        ) {
          const panel = widget as NotebookPanel;
          await panel.context.ready;

          // Get the attached cell indexes in order.
          const cellList = panel.context.model.cells;
          const cellIds = attachment.cells.map(cell => cell.id);
          const range: number[] = [];
          for (let i = 0; i < cellList.length; i++) {
            if (cellIds.includes(cellList.get(i).id)) {
              range.push(i);
            }
          }
          range.sort();

          // Set the first cell as active.
          panel.content.activeCellIndex = range[0];

          // If cells are contiguous, select all of them.
          if (isContinuous(range)) {
            panel.content.extendContiguousSelectionTo(range[range.length - 1]);
          }
        }
      }
    );

    // Build the chat.
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
      ),
      attachmentOpenerRegistry,
      inputToolbarRegistry
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

    // Listen for writers change to display the stop button.
    function writersChanged(_: IChatModel, writers: IChatModel.IWriter[]) {
      // Check if AI is currently writing (streaming)
      const aiWriting = writers.some(
        writer => writer.user.username === TUTOR_USER.username
      );

      if (aiWriting) {
        inputToolbarRegistry?.show('stop');
      } else {
        inputToolbarRegistry?.hide('stop');
      }
    }

    tutorModel.writersChanged?.connect(writersChanged);

    function messagesChanged(model: IChatModel) {
      if (model.messages.length) {
        inputToolbarRegistry?.show('clear');
      } else {
        inputToolbarRegistry?.hide('clear');
      }
    }

    tutorModel.messagesUpdated.connect(messagesChanged);

    // the command to ask for explanation.
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

        // Collect preceding markdown cells as exercise description context.
        const notebook = notebookTracker?.currentWidget?.content;
        const notebookPath = notebookTracker?.currentWidget?.context.path ?? '';
        let description: string | undefined;
        let attachment: INotebookAttachment | undefined;

        if (notebook) {
          const activeCellIndex = notebook.activeCellIndex;
          const markdownCells: { id: string; source: string }[] = [];

          for (let i = activeCellIndex - 1; i >= 0; i--) {
            const precedingCell = notebook.widgets[i];
            if (precedingCell.model.type === 'code') {
              break;
            }
            if (precedingCell.model.type === 'markdown') {
              const mdSource = precedingCell.model.sharedModel.source.trim();
              if (mdSource) {
                markdownCells.unshift({
                  id: precedingCell.model.id,
                  source: mdSource
                });
              }
            }
          }

          if (markdownCells.length > 0) {
            description = markdownCells.map(c => c.source).join('\n\n');
            attachment = {
              type: 'notebook',
              value: notebookPath,
              cells: markdownCells.map(c => ({
                id: c.id,
                input_type: 'markdown' as const
              }))
            };
          }
        }

        // Retrieve and decode reference_solution from metadata
        const rawSolution = cell.model.getMetadata('reference_solution');
        const referenceSolution =
          typeof rawSolution === 'string' ? decodeRot13(rawSolution) : '';

        // Retrieve and format evaluation_criteria from metadata
        const rawCriteria = cell.model.getMetadata('evaluation_criteria');
        const evaluationCriteria = formatEvaluationCriteria(rawCriteria);

        const question = errorSection
          ? 'Can you explain this code and the error it produced?'
          : 'Can you explain this code?';
        const bodyContent = `${question}\n\n\`\`\`${language}\n${source}\n\`\`\`${errorSection}\n`;

        let formattedBody = '';
        if (description) {
          formattedBody += `<exercise_description>\n${description}\n</exercise_description>\n\n`;
        }
        formattedBody += bodyContent;
        if (referenceSolution) {
          formattedBody += `\n\n<reference_solution>\n${referenceSolution}\n</reference_solution>`;
        }
        if (evaluationCriteria) {
          formattedBody += `\n\n<evaluation_criteria>\n${evaluationCriteria}\n</evaluation_criteria>`;
        }

        if (!chatWidget.isAttached) {
          app.shell.add(chatWidget, 'right');
        }
        app.shell.activateById(chatWidget.id);

        await tutorModel.sendMessageToAI({
          body: formattedBody,
          notebookPath,
          attachments: attachment ? [attachment] : undefined
        });
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
