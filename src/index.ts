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
import { codeCheckIcon, infoIcon } from '@jupyterlab/ui-components';

import { clearItem, stopItem } from './components';
import { TUTOR_USER, TutorChatModel } from './model';
import { decodeSolution, isContinuous } from './utils';

const INFO_ICON_BASE_64 = btoa(infoIcon.svgstr);
const CHECK_ICON_BASE_64 = btoa(codeCheckIcon.svgstr);

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
  export const reviewCode = 'jupyter-ai-tutor:review-code';
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
        `## Select a code cell and click **Explain Code** <img src="data:image/svg+xml;base64,${INFO_ICON_BASE_64}" /> or **Review Code** <img src="data:image/svg+xml;base64,${CHECK_ICON_BASE_64}" /> to get started.`
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
      commands.notifyCommandChanged(CommandIDs.reviewCode);
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

    async function executeAction(action: 'explain' | 'review') {
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
      let jsonError: {
        ename: string;
        evalue: string;
        traceback: string[];
      } | null = null;

      for (let i = 0; i < outputs.length; i++) {
        const output = outputs.get(i);
        if (output.type === 'error') {
          const json = output.toJSON() as {
            ename: string;
            evalue: string;
            traceback: string[];
          };
          jsonError = json;
          const traceback = json.traceback
            .map(line => line.replace(ANSI_ESCAPE, ''))
            .join('\n');
          errorSection =
            `\n\n**Error:**\n\`\`\`\n${json.ename}: ${json.evalue}\n` +
            `${traceback}\n\`\`\``;
          break;
        }
      }

      // Collect preceding cells context.
      const notebook = notebookTracker?.currentWidget?.content;
      const notebookPath = notebookTracker?.currentWidget?.context.path ?? '';
      let studentContext = '';
      let attachment: INotebookAttachment | undefined;

      if (notebook) {
        const activeCellIndex = notebook.activeCellIndex;
        let lastMdIdx = -1;

        // Find the index of the most recent markdown cell above the active cell
        for (let i = activeCellIndex - 1; i >= 0; i--) {
          const precedingCell = notebook.widgets[i];
          if (precedingCell.model.type === 'markdown') {
            lastMdIdx = i;
            break;
          }
        }

        // Gather all cells from that markdown cell up to activeCellIndex - 1
        const startIdx = lastMdIdx !== -1 ? lastMdIdx : 0;

        const contextCells = [];
        for (let i = startIdx; i < activeCellIndex; i++) {
          contextCells.push(notebook.widgets[i]);
        }

        let contextStr = '';
        const cellsForAttachment = [];

        for (const cCell of contextCells) {
          const cSource = cCell.model.sharedModel.source.trim();
          if (!cSource) {
            continue;
          }

          cellsForAttachment.push({
            id: cCell.model.id,
            input_type: cCell.model.type as 'raw' | 'markdown' | 'code'
          });

          if (cCell.model.type === 'markdown') {
            contextStr += `${cSource}\n\n`;
          } else if (cCell.model.type === 'code') {
            contextStr += `Preceding Code:\n\`\`\`${language}\n${cSource}\n\`\`\`\n\n`;
          }
        }

        studentContext = contextStr.trim();

        if (cellsForAttachment.length > 0) {
          attachment = {
            type: 'notebook',
            value: notebookPath,
            cells: cellsForAttachment
          };
        }
      }
      // Format student answer
      let studentAnswer = source;
      if (jsonError) {
        const traceback = jsonError.traceback
          .map(line => line.replace(ANSI_ESCAPE, ''))
          .join('\n');
        studentAnswer += `\n\nError:\n${jsonError.ename}: ${jsonError.evalue}\n${traceback}`;
      }

      // Retrieve and decode reference_solution from metadata
      const rawSolution = cell.model.getMetadata('reference_solution');
      const referenceSolution =
        typeof rawSolution === 'string' ? decodeSolution(rawSolution) : '';

      // Retrieve evaluation_criteria from metadata
      const evaluationCriteria = cell.model.getMetadata(
        'evaluation_criteria'
      );

      // Retrieve initial_source from metadata
      const initialSource = cell.model.getMetadata('initial_source');

      const actionTitle = action === 'review' ? 'Review code' : 'Explain code';
      const question = errorSection
        ? `${actionTitle} and error`
        : actionTitle;
      const bodyContent = `${question}\n\n\`\`\`${language}\n${source}\n\`\`\`${errorSection}\n`;

      let formattedBody = '';
      if (studentContext) {
        formattedBody += `<context>\n${studentContext}\n</context>\n\n`;
      }
      formattedBody += `<source>\n${studentAnswer}\n</source>`;

      if (initialSource && typeof initialSource === 'string') {
        formattedBody += `\n\n<initial_source>\n${initialSource}\n</initial_source>`;
      }
      if (referenceSolution) {
        formattedBody += `\n\n<reference_solution>\n${referenceSolution}\n</reference_solution>`;
      }
      if (evaluationCriteria && typeof evaluationCriteria === 'string') {
        formattedBody += `\n\n<evaluation_criteria>\n${evaluationCriteria}\n</evaluation_criteria>`;
      }

      formattedBody += '\n';

      if (!chatWidget.isAttached) {
        app.shell.add(chatWidget, 'right');
      }
      app.shell.activateById(chatWidget.id);

      await tutorModel.sendMessageToAI({
        body: bodyContent,
        formattedBody: formattedBody,
        notebookPath,
        action,
        payload: {
          source: studentAnswer,
          context: studentContext,
          initial_source:
            typeof initialSource === 'string' ? initialSource : '',
          reference_solution: referenceSolution,
          evaluation_criteria:
            typeof evaluationCriteria === 'string' ? evaluationCriteria : ''
        },
        attachments: attachment ? [attachment] : undefined
      });
    }

    // Register Explain Code command
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
        await executeAction('explain');
      },
      describedBy: {
        args: {
          type: 'object',
          properties: {}
        }
      }
    });

    // Register Review Code command
    commands.addCommand(CommandIDs.reviewCode, {
      label: trans.__('Review Code'),
      caption: trans.__('Send cell content to AI tutor for review'),
      icon: codeCheckIcon,
      isEnabled: () => {
        const cell = notebookTracker?.activeCell;
        return !!cell && cell.model.type === 'code';
      },
      isVisible: () => true,
      execute: async () => {
        await executeAction('review');
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
