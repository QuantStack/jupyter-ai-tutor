import {
  CommandToolbarButtonComponent,
  ReactWidget
} from '@jupyterlab/ui-components';
import { NotebookPanel } from '@jupyterlab/notebook';
import { CommandRegistry } from '@lumino/commands';

import React from 'react';

import { TutorMdManager } from '../tutor-md';

/**
 * The CSS class of the tutor actions toolbar item.
 */
const ACTIONS_TOOLBAR_CLASS = 'jp-ai-tutor-ActionsToolbar';

/**
 * A cell toolbar item displaying one button per tutor action of the notebook.
 *
 * All the buttons run the same command, with the action id as argument.
 */
export class ActionsToolbar extends ReactWidget {
  /**
   * Creates the tutor actions toolbar item.
   * @param options - The commands registry, command id, TUTOR.md manager and notebook
   */
  constructor(options: ActionsToolbar.IOptions) {
    super();
    this._commands = options.commands;
    this._commandId = options.commandId;
    this._tutorMd = options.tutorMd;
    this._notebook = options.notebook;
    this.addClass(ACTIONS_TOOLBAR_CLASS);
    this._tutorMd.changed.connect(this._onConfigChanged, this);
    this._loadConfig();
  }

  /**
   * Disposes the widget and disconnects from the TUTOR.md manager.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._tutorMd.changed.disconnect(this._onConfigChanged, this);
    super.dispose();
  }

  /**
   * Renders one command button per action, with the icon only if available.
   */
  protected render(): JSX.Element {
    const notebookPath = this._notebookPath;
    const actions = this._tutorMd.getCached(notebookPath)?.actions ?? [];
    return (
      <>
        {actions.map(action => (
          <CommandToolbarButtonComponent
            key={action.id}
            commands={this._commands}
            id={this._commandId}
            args={{ action: action.id, notebookPath }}
            label={action.icon || action.iconClass ? '' : undefined}
          />
        ))}
      </>
    );
  }

  /**
   * Re-renders the widget when the notebook configuration changes.
   */
  private _onConfigChanged(): void {
    this._loadConfig();
    this.update();
  }

  /**
   * Loads the notebook configuration if it is not cached yet. The widget is
   * updated through the `changed` signal once loaded.
   */
  private _loadConfig(): void {
    if (this._tutorMd.getCached(this._notebookPath)) {
      return;
    }
    this._tutorMd.get(this._notebookPath).catch(err => {
      console.error('Failed to load the tutor actions:', err);
    });
  }

  /**
   * The current path of the notebook, which changes if the notebook is moved.
   */
  private get _notebookPath(): string {
    return this._notebook?.context.path ?? '';
  }

  private _commands: CommandRegistry;
  private _commandId: string;
  private _tutorMd: TutorMdManager;
  private _notebook: NotebookPanel | null;
}

/**
 * The namespace for the tutor actions toolbar item.
 */
export namespace ActionsToolbar {
  /**
   * The tutor actions toolbar item options.
   */
  export interface IOptions {
    /**
     * The application commands registry.
     */
    commands: CommandRegistry;
    /**
     * The command run by each button, with the action id as argument.
     */
    commandId: string;
    /**
     * The TUTOR.md manager providing the notebook actions.
     */
    tutorMd: TutorMdManager;
    /**
     * The notebook containing the cell, if any.
     */
    notebook: NotebookPanel | null;
  }
}
