import * as nbformat from '@jupyterlab/nbformat';

import { IPromptContext, renderPrompt } from '../prompt';

const MARKDOWN_CELL: nbformat.IMarkdownCell = {
  cell_type: 'markdown',
  source: '# Exercise 1\n\nCompute the sum of a list.',
  metadata: {}
};

const CODE_CELL: nbformat.ICodeCell = {
  cell_type: 'code',
  source: 'total = sum(values)',
  metadata: {
    reference_solution: 'total = sum(values)',
    evaluation_criteria: 'Uses the built-in sum function'
  },
  execution_count: 1,
  outputs: []
};

const CONTEXT: IPromptContext = {
  action: 'review',
  notebook: {
    cells: [MARKDOWN_CELL, CODE_CELL],
    metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
    nbformat: 4,
    nbformat_minor: 5
  },
  cell: CODE_CELL,
  cell_index: 1
};

describe('renderPrompt', () => {
  it('should return a prompt without template syntax unchanged', () => {
    expect(renderPrompt('## Tone\n\n- Be patient.', CONTEXT)).toBe(
      '## Tone\n\n- Be patient.'
    );
  });

  it('should return an empty string for an empty template', () => {
    expect(renderPrompt('', CONTEXT)).toBe('');
  });

  it('should expose the cell source and metadata', () => {
    const template = `Cell type: {{ cell.cell_type }}
{% if cell.metadata.evaluation_criteria %}
Criteria: {{ cell.metadata.evaluation_criteria }}
{% endif %}
{% if cell.metadata.missing %}
Missing
{% endif %}
Source: {{ cell.source }}`;
    expect(renderPrompt(template, CONTEXT)).toBe(
      'Cell type: code\nCriteria: Uses the built-in sum function\nSource: total = sum(values)'
    );
  });

  it('should expose the notebook, the cell index and the action', () => {
    const template = `{{ action }} {{ cell_index }} {{ notebook.metadata.kernelspec.name }}
{% for previous in notebook.cells[:cell_index] %}
{{ previous.cell_type }}: {{ previous.source }}
{% endfor %}`;
    expect(renderPrompt(template, CONTEXT)).toBe(
      'review 1 python3\nmarkdown: # Exercise 1\n\nCompute the sum of a list.'
    );
  });

  it('should throw on an invalid template', () => {
    expect(() => renderPrompt('{% if %}', CONTEXT)).toThrow();
  });
});
