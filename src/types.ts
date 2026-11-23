import { LabIcon } from '@jupyterlab/ui-components';

/**
 * The notebook cell types a tutor action can apply to.
 */
export const TUTOR_CELL_TYPES = ['code', 'markdown', 'raw'] as const;

/**
 * A notebook cell type a tutor action can apply to.
 */
export type TutorCellType = (typeof TUTOR_CELL_TYPES)[number];

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
   * JupyterLab icon of the action button.
   */
  icon?: LabIcon;
  /**
   * Font Awesome classes of the action button icon (e.g. `fa fa-lightbulb`),
   * used only if `icon` is not set. The label is displayed instead of the icon
   * if none of them is set.
   */
  iconClass?: string;
  /**
   * The cell types the action applies to.
   */
  cellTypes: TutorCellType[];
  /**
   * Instructions specific to the action, appended to the common system prompt.
   * It is a Jinja template, rendered when the action is run.
   */
  prompt: string;
}

/**
 * The tutor configuration parsed from a TUTOR.md file.
 */
export interface ITutorConfig {
  /**
   * The system prompt common to all the actions. It is a Jinja template,
   * rendered when an action is run.
   */
  systemPrompt: string;
  /**
   * The actions available.
   */
  actions: ITutorAction[];
}
