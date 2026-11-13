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
   * Icon of the action button.
   */
  icon: LabIcon;
  /**
   * Whether the action is only enabled when the cell source differs from its
   * `initial_source` metadata.
   */
  requiresChange?: boolean;
}
