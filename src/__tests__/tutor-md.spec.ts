import { PathExt } from '@jupyterlab/coreutils';
import { Contents } from '@jupyterlab/services';
import { codeCheckIcon, infoIcon } from '@jupyterlab/ui-components';
import { Signal } from '@lumino/signaling';

import { parseTutorMd, TutorMdManager } from '../tutor-md';

const TUTOR_MD = `You are an AI tutor embedded in JupyterLab.

## Tone

- Be encouraging and patient.

---
scenario: "explain"
icon: infoIcon
tooltip: "Explain cell content"
---

## Action

- Ask guiding questions that lead the student toward the answer themselves.

---
scenario: "review"
icon: codeCheckIcon
tooltip: "Review the student answer"
---

## Action

- Evaluate the student's current code in \`<source>\`.
`;

describe('parseTutorMd', () => {
  it('should parse the common prompt and the actions', () => {
    const config = parseTutorMd(TUTOR_MD);

    expect(config.systemPrompt).toMatch(/^You are an AI tutor/);
    expect(config.systemPrompt).toMatch(/## Tone/);
    expect(config.systemPrompt).not.toMatch(/scenario:/);

    expect(config.actions.map(action => action.id)).toEqual([
      'explain',
      'review'
    ]);
    const [explain, review] = config.actions;
    expect(explain.icon).toBe(infoIcon);
    expect(explain.caption).toBe('Explain cell content');
    expect(explain.prompt).toMatch(/^## Action\n\n- Ask guiding questions/);
    expect(review.icon).toBe(codeCheckIcon);
    expect(review.prompt).toMatch(/Evaluate the student's current code/);
    expect(review.prompt).not.toMatch(/Ask guiding questions/);
  });

  it('should keep horizontal rules that are not action headers', () => {
    const config = parseTutorMd(
      'Common\n\n---\n\nStill common\n\n---\nscenario: hint\nlabel: Hint\n---\nGive a hint'
    );
    expect(config.systemPrompt).toBe('Common\n\n---\n\nStill common');
    expect(config.actions).toHaveLength(1);
    expect(config.actions[0]).toMatchObject({
      id: 'hint',
      label: 'Hint',
      caption: 'Hint',
      icon: undefined,
      prompt: 'Give a hint'
    });
  });

  it('should parse the cell types', () => {
    const cellTypes = (header: string): string[] =>
      parseTutorMd(`---\nscenario: hint\n${header}\n---\n`).actions[0]
        .cellTypes;

    expect(cellTypes('')).toEqual(['code', 'markdown']);
    expect(cellTypes('cell-types: [raw, code]')).toEqual(['raw', 'code']);
    expect(cellTypes('cell-types: markdown')).toEqual(['markdown']);
    expect(cellTypes('cell-types: [code, unknown, code]')).toEqual(['code']);
    expect(cellTypes('cell-types:')).toEqual(['code', 'markdown']);
    expect(cellTypes('cell-types: [unknown]')).toEqual([]);
    expect(cellTypes('cell-types: []')).toEqual([]);
  });

  it('should parse Font Awesome icons', () => {
    const iconClass = (header: string): string | undefined =>
      parseTutorMd(`---\nscenario: hint\n${header}\n---\n`).actions[0]
        .iconClass;

    expect(iconClass('icon-fa: fa-lightbulb')).toBe('fa fa-lightbulb');
    expect(iconClass('icon-fa: far fa-question-circle')).toBe(
      'far fa-question-circle'
    );
    expect(iconClass('icon-fa: "fa-lightbulb my-class"')).toBeUndefined();
  });

  it('should prefer the JupyterLab icon over the Font Awesome one', () => {
    const [action] = parseTutorMd(
      '---\nscenario: hint\nicon: infoIcon\nicon-fa: fa-lightbulb\n---\n'
    ).actions;
    expect(action.icon).toBe(infoIcon);
    expect(action.iconClass).toBeUndefined();
  });

  it('should return no action without action headers', () => {
    const config = parseTutorMd('Only a system prompt');
    expect(config.systemPrompt).toBe('Only a system prompt');
    expect(config.actions).toEqual([]);
  });
});

/**
 * A minimal contents manager serving TUTOR.md files.
 */
class FakeContentsManager {
  /**
   * The TUTOR.md files, by path.
   */
  files = new Map<string, string>();
  /**
   * The number of files read.
   */
  reads = 0;
  fileChanged = new Signal<this, Contents.IChangedArgs>(this);

  driveName(): string {
    return '';
  }

  localPath(path: string): string {
    return path;
  }

  async get(
    path: string,
    options?: Contents.IFetchOptions
  ): Promise<Partial<Contents.IModel>> {
    if (options?.type === 'directory') {
      const content = [...this.files.keys()]
        .filter(file => PathExt.dirname(file) === path)
        .map(file => ({
          type: 'file',
          name: PathExt.basename(file),
          path: file
        }));
      return { path, content };
    }
    this.reads++;
    return { path, content: this.files.get(path) };
  }

  /**
   * Emits a file change for a TUTOR.md file.
   */
  emit(type: Contents.IChangedArgs['type'], path: string): void {
    this.fileChanged.emit({
      type,
      oldValue: type === 'delete' ? { path } : null,
      newValue: type === 'delete' ? null : { path }
    });
  }
}

/**
 * Returns a TUTOR.md content with a single action using the given icon.
 */
const tutorMdWithIcon = (icon: string): string =>
  `---\nscenario: hint\nicon: ${icon}\n---\nGive a hint`;

/**
 * Waits for the pending promises to be settled.
 */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve));

describe('TutorMdManager', () => {
  let contents: FakeContentsManager;
  let manager: TutorMdManager;
  let changes: number;

  beforeEach(() => {
    contents = new FakeContentsManager();
    contents.files.set('TUTOR.md', tutorMdWithIcon('infoIcon'));
    manager = new TutorMdManager({
      contentsManager: contents as unknown as Contents.IManager,
      discover: true
    });
    changes = 0;
    manager.changed.connect(() => changes++);
  });

  it('should load and cache the configuration', async () => {
    const config = await manager.get('course/nb.ipynb');
    expect(config.actions[0].icon).toBe(infoIcon);
    expect(manager.getCached('course/nb.ipynb')).toBe(config);
    await manager.get('course/nb.ipynb');
    expect(contents.reads).toBe(1);
    expect(changes).toBe(1);
  });

  it('should update the notebooks using a saved TUTOR.md', async () => {
    contents.files.set('other/TUTOR.md', tutorMdWithIcon('infoIcon'));
    await manager.get('course/nb.ipynb');
    const other = await manager.get('other/nb.ipynb');
    changes = 0;

    manager.updateTutorMd('TUTOR.md', tutorMdWithIcon('codeCheckIcon'));

    expect(manager.getCached('course/nb.ipynb')?.actions[0].icon).toBe(
      codeCheckIcon
    );
    expect((await manager.get('course/nb.ipynb')).actions[0].icon).toBe(
      codeCheckIcon
    );
    expect(manager.getCached('other/nb.ipynb')).toBe(other);
    expect(changes).toBe(1);
  });

  it('should not emit when a saved TUTOR.md is unchanged', async () => {
    const config = await manager.get('course/nb.ipynb');
    changes = 0;
    manager.updateTutorMd('TUTOR.md', tutorMdWithIcon('infoIcon') + '\n');
    expect(manager.getCached('course/nb.ipynb')).toBe(config);
    expect(changes).toBe(0);
  });

  it('should use a TUTOR.md created closer to the notebook', async () => {
    await manager.get('course/nb.ipynb');
    contents.files.set('course/TUTOR.md', tutorMdWithIcon('codeCheckIcon'));
    contents.emit('new', 'course/TUTOR.md');
    await flush();
    expect(manager.getCached('course/nb.ipynb')?.actions[0].icon).toBe(
      codeCheckIcon
    );
  });

  it('should fall back on the parent TUTOR.md when deleted', async () => {
    contents.files.set('course/TUTOR.md', tutorMdWithIcon('codeCheckIcon'));
    await manager.get('course/nb.ipynb');
    contents.files.delete('course/TUTOR.md');
    contents.emit('delete', 'course/TUTOR.md');
    await flush();
    expect(manager.getCached('course/nb.ipynb')?.actions[0].icon).toBe(
      infoIcon
    );
  });

  it('should only reload the notebooks using a TUTOR.md reported as saved', async () => {
    contents.files.set('other/TUTOR.md', tutorMdWithIcon('infoIcon'));
    await manager.get('course/nb.ipynb');
    await manager.get('other/nb.ipynb');
    contents.reads = 0;

    contents.files.set('other/TUTOR.md', tutorMdWithIcon('codeCheckIcon'));
    contents.emit('save', 'other/TUTOR.md');
    await flush();

    expect(contents.reads).toBe(1);
    expect(manager.getCached('other/nb.ipynb')?.actions[0].icon).toBe(
      codeCheckIcon
    );
  });

  it('should load the configuration again after forgetting it', async () => {
    await manager.get('course/nb.ipynb');
    manager.forget('course/nb.ipynb');
    expect(manager.getCached('course/nb.ipynb')).toBeUndefined();

    contents.files.set('TUTOR.md', tutorMdWithIcon('codeCheckIcon'));
    const config = await manager.get('course/nb.ipynb');
    expect(config.actions[0].icon).toBe(codeCheckIcon);
  });

  it('should not cache a configuration forgotten while loading', async () => {
    const pending = manager.get('course/nb.ipynb');
    manager.forget('course/nb.ipynb');
    await pending;
    expect(manager.getCached('course/nb.ipynb')).toBeUndefined();
  });
});
