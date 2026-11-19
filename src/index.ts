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
import { Cell, ICodeCellModel } from '@jupyterlab/cells';
import { PageConfig, PathExt } from '@jupyterlab/coreutils';
import { IDocumentWidget } from '@jupyterlab/docregistry';
import { FileEditor, IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { IToolbarWidgetRegistry, showErrorMessage } from '@jupyterlab/apputils';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';

import { clearItem, stopItem } from './components';
import { TUTOR_USER, TutorChatModel } from './model';
import { TUTOR_MD_FILENAME, TutorMdManager } from './tutor-md';
import { ITutorAction, ITutorConfig } from './types';
import { decodeSolution, isContinuous } from './utils';
import { ActionsToolbar } from './widgets/actions-toolbar';

// Matches ANSI escape sequences used for terminal colors in tracebacks.
const ANSI_ESCAPE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`,
  'g'
);

/**
 * Page config key exposing the server 'discover_tutor_md' option.
 */
const PAGE_CONFIG_DISCOVER_TUTOR_MD = 'jupyterAiTutorDiscoverTutorMd';

/**
 * Name of the cell toolbar item displaying the tutor actions.
 */
const ACTIONS_TOOLBAR_ITEM = 'jupyter-ai-tutor:actions';

/**
 * Command IDs used by the jupyter-ai-tutor extension.
 */
namespace CommandIDs {
  export const runAction = 'jupyter-ai-tutor:run-action';
}

/**
 * Initialization data for the jupyter-ai-tutor extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyter-ai-tutor:plugin',
  description:
    'A JupyterLab extension to add an AI-powered tutor assistant to Notebooks.',
  autoStart: true,
  requires: [IRenderMimeRegistry, IToolbarWidgetRegistry],
  optional: [ISettingRegistry, INotebookTracker, ITranslator, IEditorTracker],
  activate: (
    app: JupyterFrontEnd,
    rmRegistry: IRenderMimeRegistry,
    toolbarRegistry: IToolbarWidgetRegistry,
    settingRegistry: ISettingRegistry | null,
    notebookTracker: INotebookTracker | null,
    translator: ITranslator | null,
    editorTracker: IEditorTracker | null
  ) => {
    const { commands } = app;
    const trans = (translator ?? nullTranslator).load('jupyterlab');

    // The TUTOR.md manager, providing the system prompt and actions of notebooks.
    const tutorMd = new TutorMdManager({
      contentsManager: app.serviceManager.contents,
      discover:
        PageConfig.getOption(PAGE_CONFIG_DISCOVER_TUTOR_MD).toLowerCase() !==
        'false'
    });

    // Refresh the actions buttons when a notebook configuration changes.
    tutorMd.changed.connect(() => {
      commands.notifyCommandChanged(CommandIDs.runAction);
    });

    // Follow the notebooks lifecycle: load the configuration as soon as a
    // notebook is opened to display the actions buttons without delay, reload
    // it when the notebook is moved, and forget it when the notebook is closed.
    notebookTracker?.widgetAdded.connect((_, panel) => {
      let notebookPath = panel.context.path;
      const load = (): void => {
        tutorMd.get(notebookPath).catch(err => {
          console.error('Failed to load the tutor actions:', err);
        });
      };
      // Other views of the notebook share the same path, keep its
      // configuration while one of them is still open.
      const forgetIfUnused = (path: string): void => {
        const used = notebookTracker.find(
          other => other !== panel && other.context.path === path
        );
        if (!used) {
          tutorMd.forget(path);
        }
      };
      panel.context.pathChanged.connect((_, newPath) => {
        const oldPath = notebookPath;
        notebookPath = newPath;
        forgetIfUnused(oldPath);
        load();
      });
      panel.disposed.connect(() => forgetIfUnused(notebookPath));
      load();
    });

    /**
     * Updates the notebooks using a TUTOR.md file each time it is saved from a
     * file editor. The document is not dirty anymore once saved, either by the
     * frontend or by the server (autosave of real-time collaboration).
     */
    const watchEditor = (widget: IDocumentWidget<FileEditor>): void => {
      const { context } = widget;
      context.model.stateChanged.connect((_, change) => {
        if (
          change.name === 'dirty' &&
          change.newValue === false &&
          PathExt.basename(context.path) === TUTOR_MD_FILENAME
        ) {
          tutorMd.updateTutorMd(context.path, context.model.toString());
        }
      });
    };
    editorTracker?.forEach(watchEditor);
    editorTracker?.widgetAdded.connect((_, widget) => watchEditor(widget));

    /**
     * Returns the tutor action matching the command arguments, from the
     * configuration of the notebook in arguments, or of the current notebook.
     */
    const getAction = (
      args: ReadonlyPartialJSONObject
    ): ITutorAction | undefined => {
      const notebookPath =
        typeof args.notebookPath === 'string'
          ? args.notebookPath
          : notebookTracker?.currentWidget?.context.path;
      if (!notebookPath) {
        return undefined;
      }
      return tutorMd
        .getCached(notebookPath)
        ?.actions.find(action => action.id === args.action);
    };

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
        'Select a code cell and click one of the tutor buttons in the cell toolbar to get started.'
      ),
      attachmentOpenerRegistry,
      inputToolbarRegistry
    });
    chatWidget.id = 'jupyter-ai-tutor-panel';
    chatWidget.title.label = trans.__('Tutor');
    chatWidget.title.caption = trans.__('Tutor');
    chatWidget.title.closable = true;
    app.shell.add(chatWidget, 'right');

    let previousCell: Cell | null = null;
    const onContentChanged = () => {
      commands.notifyCommandChanged(CommandIDs.runAction);
    };

    // Keep the enabled state in sync when active cell or cell content changes.
    notebookTracker?.activeCellChanged.connect((_, cell) => {
      commands.notifyCommandChanged(CommandIDs.runAction);

      if (previousCell && !previousCell.isDisposed) {
        previousCell.model.contentChanged.disconnect(onContentChanged);
      }
      if (cell) {
        cell.model.contentChanged.connect(onContentChanged);
      }
      previousCell = cell;
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

    async function executeAction(tutorAction: ITutorAction) {
      const action = tutorAction.id;
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
      const evaluationCriteria = cell.model.getMetadata('evaluation_criteria');

      // Retrieve initial_source from metadata
      const initialSource = cell.model.getMetadata('initial_source');

      const actionTitle = tutorAction.label;
      const question = errorSection ? `${actionTitle} and error` : actionTitle;
      const bodyContent = `${question}\n\n\`\`\`${language}\n${source}\n\`\`\`${errorSection}\n`;

      let formattedBody = `<action>${action}</action>\n\n`;
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

      let config: ITutorConfig;
      try {
        config = await tutorMd.get(notebookPath);
      } catch (err) {
        console.error('Failed to load the tutor system prompt:', err);
        showErrorMessage(
          trans.__('Tutor error'),
          trans.__('Failed to load the tutor system prompt.')
        );
        return;
      }
      const systemPrompt = tutorAction.prompt
        ? `${config.systemPrompt}\n\n${tutorAction.prompt}`
        : config.systemPrompt;

      await tutorModel.sendMessageToAI({
        body: bodyContent,
        formattedBody: formattedBody,
        systemPrompt,
        action,
        attachments: attachment ? [attachment] : undefined
      });
    }

    // Register the command running a tutor action on the active cell.
    commands.addCommand(CommandIDs.runAction, {
      label: args => getAction(args)?.label ?? trans.__('Run Tutor Action'),
      caption: args => getAction(args)?.caption ?? '',
      icon: args => getAction(args)?.icon,
      iconClass: args => getAction(args)?.iconClass ?? '',
      isEnabled: args => {
        const action = getAction(args);
        const cell = notebookTracker?.activeCell;
        if (!action || !cell || cell.model.type !== 'code') {
          return false;
        }
        return cell.model.sharedModel.source.trim() !== '';
      },
      execute: async args => {
        const action = getAction(args);
        if (!action) {
          console.warn('Unknown tutor action:', args.action);
          return;
        }
        await executeAction(action);
      },
      describedBy: {
        args: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: trans.__('The id of the tutor action to run')
            },
            notebookPath: {
              type: 'string',
              description: trans.__(
                'The path of the notebook providing the action, defaults to the current notebook'
              )
            }
          },
          required: ['action']
        }
      }
    });

    // Display all the tutor actions in a single cell toolbar item.
    toolbarRegistry.addFactory('Cell', ACTIONS_TOOLBAR_ITEM, cell => {
      let panel = cell.parent;
      while (panel && !(panel instanceof NotebookPanel)) {
        panel = panel.parent;
      }
      return new ActionsToolbar({
        commands,
        commandId: CommandIDs.runAction,
        tutorMd,
        notebook: panel instanceof NotebookPanel ? panel : null
      });
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
