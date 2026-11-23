import { Template } from '@huggingface/jinja';
import * as nbformat from '@jupyterlab/nbformat';

/**
 * The variables available in the TUTOR.md templates.
 */
export interface IPromptContext {
  /**
   * The id of the action being run.
   */
  action: string;
  /**
   * The notebook, in nbformat.
   */
  notebook: nbformat.INotebookContent;
  /**
   * The cell the action is run on, in nbformat.
   */
  cell: nbformat.ICell;
  /**
   * The index of the cell in `notebook.cells`.
   */
  cell_index: number;
}

/**
 * Renders a Jinja template of the TUTOR.md file (system prompt or action
 * instructions) with the action context.
 * @param template - The Jinja template
 * @param context - The variables available in the template
 * @returns The rendered and trimmed prompt
 * @throws If the template is not valid
 */
export function renderPrompt(
  template: string,
  context: IPromptContext
): string {
  if (!template) {
    return '';
  }
  return new Template(template).render({ ...context }).trim();
}
