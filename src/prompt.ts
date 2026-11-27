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
 * Matches ANSI escape sequences used for terminal colors in tracebacks.
 */
const ANSI_ESCAPE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`,
  'g'
);

/**
 * Removes the ANSI escape sequences (terminal colors) from a text.
 * @param text - The text, e.g. a traceback line
 * @returns The text without escape sequences
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

/**
 * Returns a copy of a cell whose error outputs tracebacks are free of ANSI
 * escape sequences, to be readable in the prompt.
 */
function cleanCell(cell: nbformat.ICell): nbformat.ICell {
  if (!nbformat.isCode(cell)) {
    return cell;
  }
  return {
    ...cell,
    outputs: cell.outputs.map(output =>
      nbformat.isError(output)
        ? { ...output, traceback: output.traceback.map(stripAnsi) }
        : output
    )
  };
}

/**
 * Creates the variables available in the TUTOR.md templates.
 *
 * The ANSI escape sequences are removed from the error outputs tracebacks.
 * @param action - The id of the action being run
 * @param notebook - The notebook, in nbformat
 * @param cellIndex - The index of the cell the action is run on
 * @returns The prompt context, or null if there is no cell at this index
 */
export function createPromptContext(
  action: string,
  notebook: nbformat.INotebookContent,
  cellIndex: number
): IPromptContext | null {
  const cells = notebook.cells.map(cleanCell);
  const cell = cells[cellIndex];
  if (!cell) {
    return null;
  }
  return {
    action,
    notebook: { ...notebook, cells },
    cell,
    cell_index: cellIndex
  };
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
