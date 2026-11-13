import {
  CommandToolbarButtonComponent,
  ReactWidget
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';

import React from 'react';

import { ITutorAction } from '../types';

/**
 * The CSS class of the tutor actions toolbar item.
 */
const ACTIONS_TOOLBAR_CLASS = 'jp-ai-tutor-ActionsToolbar';

/**
 * A cell toolbar item displaying one button per tutor action.
 *
 * All the buttons run the same command, with the action id as argument.
 */
export class ActionsToolbar extends ReactWidget {
  /**
   * Creates the tutor actions toolbar item.
   * @param options - The commands registry, command id and actions to display
   */
  constructor(options: ActionsToolbar.IOptions) {
    super();
    this._commands = options.commands;
    this._commandId = options.commandId;
    this._actions = options.actions;
    this.addClass(ACTIONS_TOOLBAR_CLASS);
  }

  /**
   * Renders one command button per action.
   */
  protected render(): JSX.Element {
    return (
      <>
        {this._actions.map(action => (
          <CommandToolbarButtonComponent
            key={action.id}
            commands={this._commands}
            id={this._commandId}
            args={{ action: action.id }}
            label=""
          />
        ))}
      </>
    );
  }

  private _commands: CommandRegistry;
  private _commandId: string;
  private _actions: ReadonlyArray<ITutorAction>;
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
     * The actions to display.
     */
    actions: ReadonlyArray<ITutorAction>;
  }
}
