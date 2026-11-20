import { fencedCodeBlock } from '../utils';

describe('fencedCodeBlock', () => {
  it('should use a three-backtick fence by default', () => {
    expect(fencedCodeBlock('x = 1', 'python')).toBe('```python\nx = 1\n```');
    expect(fencedCodeBlock('plain')).toBe('```\nplain\n```');
  });

  it('should use a fence longer than any backtick run in the content', () => {
    const markdown = '# Title\n\n```python\nx = 1\n```\n\nInline `code`';
    expect(fencedCodeBlock(markdown, 'markdown')).toBe(
      `\`\`\`\`markdown\n${markdown}\n\`\`\`\``
    );
    expect(fencedCodeBlock('`````')).toBe('``````\n`````\n``````');
  });
});
