import { Cell, ICellModel, ICodeCellModel } from '@jupyterlab/cells';

import { ITutorAction } from './types';

export function isContinuous(numbers: number[]): boolean {
  if (numbers.length <= 1) {
    return true;
  }

  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i - 1] + 1) {
      return false;
    }
  }

  return true;
}

/**
 * Decodes the reference solution.
 * No-op for now, but could be a ROT13 decoder.
 */
export function decodeSolution(str: string): string {
  /* TODO: switch to a ROT13 encoded solution ? */
  // return str.replace(/[a-zA-Z]/g, c => {
  //   const base = c <= 'Z' ? 65 : 97;
  //   return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  // });
  return str;
}

/**
 * Type guard for code cell models.
 * @param model - The cell model
 */
export function isCodeCellModel(model: ICellModel): model is ICodeCellModel {
  return model.type === 'code';
}

/**
 * Whether a tutor action applies to a cell, depending on its type.
 * @param action - The tutor action
 * @param cell - The cell
 */
export function isActionApplicable(action: ITutorAction, cell: Cell): boolean {
  return action.cellTypes.some(cellType => cellType === cell.model.type);
}

/**
 * Wraps a content in a Markdown fenced code block.
 *
 * The fence is longer than any backtick run in the content, so that fenced
 * blocks embedded in the content (e.g. in a Markdown cell) do not close it.
 * @param content - The content to wrap
 * @param language - The language used for syntax highlighting, if any
 * @returns The fenced code block
 */
export function fencedCodeBlock(content: string, language = ''): string {
  const longestRun = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map(run => run.length)
  );
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}
