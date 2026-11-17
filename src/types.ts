import { LabIcon } from '@jupyterlab/ui-components';

/**
 * A tutor action, displayed as a button in the cell toolbar.
 */
export interface ITutorAction {
  /**
   * Unique identifier of the action, sent to the tutor in the `<action>` block.
   */
  id: string;
  /**
   * Human readable label of the action.
   */
  label: string;
  /**
   * Tooltip of the action button.
   */
  caption: string;
  /**
   * Icon of the action button. The label is displayed instead if not set.
   */
  icon?: LabIcon;
  /**
   * Instructions specific to the action, appended to the common system prompt.
   */
  prompt: string;
}

/**
 * The tutor configuration parsed from a TUTOR.md file.
 */
export interface ITutorConfig {
  /**
   * The system prompt common to all the actions.
   */
  systemPrompt: string;
  /**
   * The actions available.
   */
  actions: ITutorAction[];
}
