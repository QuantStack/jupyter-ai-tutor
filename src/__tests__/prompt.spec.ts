/// <reference types="node" />
import * as nbformat from '@jupyterlab/nbformat';
import { readFileSync } from 'fs';
import { join } from 'path';

import { createPromptContext, IPromptContext, renderPrompt } from '../prompt';
import { parseTutorMd } from '../tutor-md';

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

describe('createPromptContext', () => {
  it('should remove the ANSI escape sequences from the tracebacks', () => {
    const errorCell: nbformat.ICodeCell = {
      ...CODE_CELL,
      outputs: [
        {
          output_type: 'error',
          ename: 'NameError',
          evalue: "name 'values' is not defined",
          traceback: ['\u001b[0;31mNameError\u001b[0m: oops']
        }
      ]
    };
    const context = createPromptContext(
      'explain',
      { ...CONTEXT.notebook, cells: [MARKDOWN_CELL, errorCell] },
      1
    );
    expect(context?.cell).toMatchObject({
      outputs: [{ traceback: ['NameError: oops'] }]
    });
    expect(context?.notebook.cells[1]).toEqual(context?.cell);
    expect(errorCell.outputs[0].traceback).toEqual([
      '\u001b[0;31mNameError\u001b[0m: oops'
    ]);
  });

  it('should return null for a missing cell', () => {
    expect(createPromptContext('explain', CONTEXT.notebook, 2)).toBeNull();
  });
});

describe('default TUTOR.md', () => {
  const { systemPrompt } = parseTutorMd(
    readFileSync(join(__dirname, '../../jupyter_ai_tutor/TUTOR.md'), 'utf-8')
  );
  const request = (context: IPromptContext): string => {
    const rendered = renderPrompt(systemPrompt, context);
    return rendered.slice(rendered.indexOf('## Request\n'));
  };

  it('should render the request of a cell with context and metadata', () => {
    const errorCell: nbformat.ICodeCell = {
      ...CODE_CELL,
      metadata: {
        ...CODE_CELL.metadata,
        initial_source: 'total = ...'
      },
      outputs: [
        { output_type: 'stream', name: 'stdout', text: 'ignored' },
        {
          output_type: 'error',
          ename: 'NameError',
          evalue: "name 'values' is not defined",
          traceback: ['Traceback line 1', 'Traceback line 2']
        }
      ]
    };
    const notebook: nbformat.INotebookContent = {
      ...CONTEXT.notebook,
      metadata: {
        kernelspec: {
          name: 'python3',
          display_name: 'Python 3',
          language: 'python'
        }
      },
      cells: [
        { cell_type: 'markdown', source: 'Previous exercise', metadata: {} },
        MARKDOWN_CELL,
        { cell_type: 'raw', source: 'raw content', metadata: {} },
        { ...CODE_CELL, source: '' },
        { ...CODE_CELL, source: 'values = [1, 2]' },
        errorCell
      ]
    };
    expect(
      request({ action: 'review', notebook, cell: errorCell, cell_index: 5 })
    ).toBe(`## Request

The requested mode is in the \`<action>\` block. Strictly follow the instructions for
this mode below.

<action>review</action>

The student is working on a code cell, whose content is in the \`<source>\` block.
Its execution failed, the error is appended to the source.

<source>
total = sum(values)

Error:
NameError: name 'values' is not defined
Traceback line 1
Traceback line 2
</source>

The \`<context>\` block contains the cells preceding the cell in the notebook. Use it
to understand what the student is expected to accomplish, and tailor your guidance to
that goal. The block is not visible to the student.

<context>
# Exercise 1

Compute the sum of a list.

Preceding code:
\`\`\`python
values = [1, 2]
\`\`\`
</context>

The \`<initial_source>\` block contains the starter code originally provided to the
student before any edits. Use it to compare against \`<source>\` and understand what the
student has changed or attempted.

<initial_source>
total = ...
</initial_source>

The \`<reference_solution>\` block contains the expected solution. Use it to help guiding
the student, without exposing its content.

<reference_solution>
total = sum(values)
</reference_solution>

The \`<evaluation_criteria>\` block contains the teacher's expectations. Use it to help
the student in accordance with them.

<evaluation_criteria>
Uses the built-in sum function
</evaluation_criteria>`);
  });

  it('should render the request of a cell without context and metadata', () => {
    expect(
      request({
        action: 'explain',
        notebook: { ...CONTEXT.notebook, metadata: {}, cells: [MARKDOWN_CELL] },
        cell: MARKDOWN_CELL,
        cell_index: 0
      })
    ).toBe(`## Request

The requested mode is in the \`<action>\` block. Strictly follow the instructions for
this mode below.

<action>explain</action>

The student is working on a markdown cell, whose content is in the \`<source>\` block.

<source>
# Exercise 1

Compute the sum of a list.
</source>`);
  });
});
