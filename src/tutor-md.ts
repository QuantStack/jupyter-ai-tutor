import { PathExt } from '@jupyterlab/coreutils';
import { Contents } from '@jupyterlab/services';
import * as uiComponents from '@jupyterlab/ui-components';
import { LabIcon } from '@jupyterlab/ui-components';
import { ISignal, Signal } from '@lumino/signaling';
import { parse as parseYaml } from 'yaml';

import { fetchDefaultSystemPrompt } from './api';
import { ITutorAction, ITutorConfig } from './types';

/**
 * The name of the file used as system prompt.
 */
export const TUTOR_MD_FILENAME = 'TUTOR.md';

/**
 * Provides the tutor configuration of notebooks, parsed from the closest
 * TUTOR.md file or from the server default.
 *
 * The configurations are cached per notebook path, until the notebook is
 * forgotten (e.g. closed). They are updated:
 * - when a TUTOR.md used by a notebook is saved from JupyterLab, through
 *   `updateTutorMd()`;
 * - when a TUTOR.md is created, deleted or renamed from JupyterLab, since it can
 *   change the TUTOR.md used by any notebook.
 *
 * Changes made outside JupyterLab are taken into account when the notebook
 * configuration is loaded again, e.g. when reopening the notebook.
 */
export class TutorMdManager {
  /**
   * Creates the TUTOR.md manager.
   * @param options - The contents manager and discovery option
   */
  constructor(options: TutorMdManager.IOptions) {
    this._contentsManager = options.contentsManager;
    this._discover = options.discover;
    this._contentsManager.fileChanged.connect(this._onFileChanged, this);
  }

  /**
   * A signal emitted when a configuration has been loaded or has changed.
   */
  get changed(): ISignal<this, void> {
    return this._changed;
  }

  /**
   * Returns the cached configuration of a notebook, without loading it.
   * @param notebookPath - Path of the notebook, as understood by the contents manager
   */
  getCached(notebookPath: string): ITutorConfig | undefined {
    return this._loaded.get(notebookPath)?.config;
  }

  /**
   * Returns the configuration of a notebook, loading it if it is not cached.
   * @param notebookPath - Path of the notebook, as understood by the contents manager
   */
  get(notebookPath: string): Promise<ITutorConfig> {
    return this._pending.get(notebookPath) ?? this._reload(notebookPath);
  }

  /**
   * Removes everything related to a notebook from the cache, e.g. when it is
   * closed. Its configuration will be loaded again on the next `get()`.
   * @param notebookPath - Path of the notebook, as understood by the contents manager
   */
  forget(notebookPath: string): void {
    this._pending.delete(notebookPath);
    this._loaded.delete(notebookPath);
    this._latestRequest.delete(notebookPath);
  }

  /**
   * Updates the configuration of the notebooks using a TUTOR.md file, e.g. when
   * it has been saved from an editor.
   * @param tutorMdPath - Path of the TUTOR.md file, as understood by the contents manager
   * @param content - The new TUTOR.md content
   */
  updateTutorMd(tutorMdPath: string, content: string): void {
    const source = content.trim();
    let config: ITutorConfig | null = null;
    for (const [notebookPath, loaded] of this._loaded) {
      if (loaded.tutorMdPath !== tutorMdPath || loaded.source === source) {
        continue;
      }
      config ??= parseTutorMd(source);
      this._loaded.set(notebookPath, { tutorMdPath, source, config });
      this._pending.set(notebookPath, Promise.resolve(config));
      // Supersede any request in progress for this notebook.
      this._latestRequest.set(notebookPath, ++this._requestCount);
    }
    if (config) {
      this._changed.emit();
    }
  }

  /**
   * Loads the configuration of a notebook in the background. The cached
   * configuration remains available while loading.
   */
  private _reload(notebookPath: string): Promise<ITutorConfig> {
    const promise = this._fetch(notebookPath);
    this._pending.set(notebookPath, promise);
    promise.catch(() => {
      if (this._pending.get(notebookPath) === promise) {
        this._pending.delete(notebookPath);
      }
    });
    return promise;
  }

  /**
   * Reads and parses the configuration of a notebook, and caches it unless a
   * more recent request has been made for this notebook in the meantime, or the
   * notebook has been forgotten. `changed` is emitted only if the TUTOR.md used
   * or its content changed.
   */
  private async _fetch(notebookPath: string): Promise<ITutorConfig> {
    const request = ++this._requestCount;
    this._latestRequest.set(notebookPath, request);

    const { path: tutorMdPath, content: source } =
      await this._readSource(notebookPath);
    const cached = this._loaded.get(notebookPath);
    if (this._latestRequest.get(notebookPath) !== request) {
      return cached?.config ?? parseTutorMd(source);
    }
    if (cached?.tutorMdPath === tutorMdPath && cached.source === source) {
      return cached.config;
    }
    const config = parseTutorMd(source);
    this._loaded.set(notebookPath, { tutorMdPath, source, config });
    this._changed.emit();
    return config;
  }

  /**
   * Reads the closest TUTOR.md file of a notebook, or the server default.
   */
  private async _readSource(notebookPath: string): Promise<Private.ISource> {
    if (this._discover) {
      const tutorMd = await Private.findTutorMd(
        this._contentsManager,
        notebookPath
      );
      if (tutorMd) {
        return tutorMd;
      }
    }
    // The server default does not change while the server is running.
    if (!this._default) {
      const promise = fetchDefaultSystemPrompt();
      this._default = promise;
      promise.catch(() => {
        if (this._default === promise) {
          this._default = null;
        }
      });
    }
    return { path: null, content: await this._default };
  }

  /**
   * Reloads the configurations affected by a TUTOR.md change made from
   * JupyterLab.
   *
   * Saving a TUTOR.md only affects the notebooks using it. Other changes
   * (creation, deletion, renaming, or saving a file not used yet such as an
   * upload) can change the TUTOR.md used by any notebook, so all the notebooks
   * are reloaded.
   */
  private _onFileChanged(
    _: Contents.IManager,
    change: Contents.IChangedArgs
  ): void {
    const paths = [change.oldValue?.path, change.newValue?.path].filter(
      (path): path is string =>
        typeof path === 'string' && PathExt.basename(path) === TUTOR_MD_FILENAME
    );
    if (!paths.length) {
      return;
    }
    const notebookPaths = [...this._pending.keys()];
    const users = notebookPaths.filter(
      notebookPath => this._loaded.get(notebookPath)?.tutorMdPath === paths[0]
    );
    const toReload =
      change.type === 'save' && users.length ? users : notebookPaths;
    for (const notebookPath of toReload) {
      this._reload(notebookPath).catch(err => {
        console.warn('Failed to reload the tutor configuration:', err);
      });
    }
  }

  private _contentsManager: Contents.IManager;
  private _discover: boolean;
  private _default: Promise<string> | null = null;
  private _pending = new Map<string, Promise<ITutorConfig>>();
  private _loaded = new Map<string, Private.ILoadedConfig>();
  private _requestCount = 0;
  private _latestRequest = new Map<string, number>();
  private _changed = new Signal<this, void>(this);
}

/**
 * The namespace for the TUTOR.md manager.
 */
export namespace TutorMdManager {
  /**
   * The TUTOR.md manager options.
   */
  export interface IOptions {
    /**
     * The contents manager used to look for TUTOR.md files.
     */
    contentsManager: Contents.IManager;
    /**
     * Whether to look for a TUTOR.md file in the file tree, walking up from the
     * notebook directory, before falling back on the server default.
     */
    discover: boolean;
  }
}

/**
 * Parses the content of a TUTOR.md file.
 *
 * The content before the first action header is the system prompt common to
 * all the actions. Each action starts with a YAML header delimited by `---`
 * lines, containing at least a `scenario` key, followed by its own instructions:
 *
 * ```
 * ---
 * scenario: explain
 * label: Explain Code
 * icon: infoIcon
 * icon-fa: far fa-question-circle
 * tooltip: Explain cell content
 * ---
 * ```
 *
 * The button icon is either a JupyterLab icon (`icon`), or a Font Awesome 5
 * icon (`icon-fa`, e.g. `fa-lightbulb` or `far fa-question-circle`). `icon`
 * takes precedence if both are provided.
 *
 * `---` blocks that are not valid YAML or do not contain a `scenario` key are
 * kept as regular Markdown content.
 * @param content - The TUTOR.md content
 * @returns The common system prompt and the actions
 */
export function parseTutorMd(content: string): ITutorConfig {
  const lines = content.split(/\r?\n/);
  const sections: { header: Private.IActionHeader | null; lines: string[] }[] =
    [{ header: null, lines: [] }];

  let index = 0;
  while (index < lines.length) {
    if (Private.HEADER_DELIMITER.test(lines[index])) {
      let end = index + 1;
      while (end < lines.length && !Private.HEADER_DELIMITER.test(lines[end])) {
        end++;
      }
      const header =
        end < lines.length
          ? Private.parseActionHeader(lines.slice(index + 1, end).join('\n'))
          : null;
      if (header) {
        sections.push({ header, lines: [] });
        index = end + 1;
        continue;
      }
    }
    sections[sections.length - 1].lines.push(lines[index]);
    index++;
  }

  const actions: ITutorAction[] = [];
  for (const { header, lines: sectionLines } of sections) {
    if (!header) {
      continue;
    }
    const { data, scenario } = header;
    if (actions.some(action => action.id === scenario)) {
      console.warn(
        `Duplicate scenario '${scenario}' in ${TUTOR_MD_FILENAME}, ignoring it`
      );
      continue;
    }
    const tooltip = Private.getString(data, 'tooltip');
    const label = Private.getString(data, 'label') ?? tooltip ?? scenario;
    const icon = Private.resolveIcon(Private.getString(data, 'icon'));
    actions.push({
      id: scenario,
      label,
      caption: tooltip ?? label,
      icon,
      iconClass: icon
        ? undefined
        : Private.resolveIconClass(Private.getString(data, 'icon-fa')),
      prompt: sectionLines.join('\n').trim()
    });
  }

  return {
    systemPrompt: sections[0].lines.join('\n').trim(),
    actions
  };
}

/**
 * The namespace for module private data.
 */
namespace Private {
  /**
   * Matches the lines delimiting the YAML header of an action section.
   */
  export const HEADER_DELIMITER = /^---\s*$/;

  /**
   * The source of a notebook configuration.
   */
  export interface ISource {
    /**
     * Path of the TUTOR.md file, as understood by the contents manager, or null
     * for the server default.
     */
    path: string | null;
    /**
     * The trimmed TUTOR.md content.
     */
    content: string;
  }

  /**
   * A configuration cached for a notebook.
   */
  export interface ILoadedConfig {
    /**
     * Path of the TUTOR.md file used, or null for the server default.
     */
    tutorMdPath: string | null;
    /**
     * The TUTOR.md content the configuration has been parsed from.
     */
    source: string;
    /**
     * The parsed configuration.
     */
    config: ITutorConfig;
  }

  /**
   * The header of an action section, delimited by `---` lines.
   */
  export interface IActionHeader {
    /**
     * The parsed YAML content of the header.
     */
    data: Record<string, unknown>;
    /**
     * The action id, from the `scenario` key.
     */
    scenario: string;
  }

  /**
   * Looks for a TUTOR.md file in the file tree, walking up from the notebook
   * directory to the root of its drive.
   * @param contentsManager - The contents manager used to browse the file tree
   * @param notebookPath - Path of the notebook, as understood by the contents manager
   * @returns The first TUTOR.md found, or null if none is available
   */
  export async function findTutorMd(
    contentsManager: Contents.IManager,
    notebookPath: string
  ): Promise<ISource | null> {
    // Keep the drive prefix, if any, to browse the same drive as the notebook.
    const driveName = contentsManager.driveName(notebookPath);
    const withDrive = (localPath: string): string =>
      driveName ? `${driveName}:${localPath}` : localPath;

    let directory = PathExt.dirname(contentsManager.localPath(notebookPath));
    while (true) {
      const tutorMd = await readTutorMdFromDirectory(
        contentsManager,
        withDrive(directory)
      );
      if (tutorMd) {
        return tutorMd;
      }
      if (directory === '') {
        return null;
      }
      directory = PathExt.dirname(directory);
    }
  }

  /**
   * Reads the TUTOR.md file of a directory, if it exists.
   * The directory is listed first to avoid requesting a missing file.
   * @param contentsManager - The contents manager used to browse the file tree
   * @param directory - Path of the directory, as understood by the contents manager
   * @returns The TUTOR.md of the directory, or null if it does not contain one
   */
  async function readTutorMdFromDirectory(
    contentsManager: Contents.IManager,
    directory: string
  ): Promise<ISource | null> {
    let listing: Contents.IModel;
    try {
      listing = await contentsManager.get(directory, {
        type: 'directory',
        content: true
      });
    } catch (err) {
      console.warn(`Failed to list directory '${directory}':`, err);
      return null;
    }

    if (!Array.isArray(listing.content)) {
      return null;
    }
    const entries: Contents.IModel[] = listing.content;
    const entry = entries.find(
      item => item.type === 'file' && item.name === TUTOR_MD_FILENAME
    );
    if (!entry) {
      return null;
    }

    try {
      const file = await contentsManager.get(entry.path, {
        type: 'file',
        format: 'text',
        content: true
      });
      return typeof file.content === 'string'
        ? { path: file.path, content: file.content.trim() }
        : null;
    } catch (err) {
      console.warn(`Failed to read '${entry.path}':`, err);
      return null;
    }
  }

  /**
   * Type guard for plain objects.
   */
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Returns the trimmed string value of a key, or undefined if it is not a
   * non-empty string.
   */
  export function getString(
    data: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = data[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  /**
   * Parses the YAML content between two `---` lines as an action header.
   * @param text - The YAML content
   * @returns The action header, or null if the content is not an action header
   */
  export function parseActionHeader(text: string): IActionHeader | null {
    let data: unknown;
    try {
      data = parseYaml(text);
    } catch {
      return null;
    }
    if (!isRecord(data)) {
      return null;
    }
    const scenario = getString(data, 'scenario');
    return scenario ? { data, scenario } : null;
  }

  /**
   * Resolves an action icon from its name.
   *
   * The name can either be a registered icon name (e.g. `ui-components:info`), or
   * the name of an icon exported by `@jupyterlab/ui-components` (e.g. `infoIcon`).
   * @param name - The icon name
   * @returns The icon, or undefined if it cannot be resolved
   */
  export function resolveIcon(name: string | undefined): LabIcon | undefined {
    if (!name) {
      return undefined;
    }
    if (name.includes(':')) {
      return LabIcon.resolve({ icon: name });
    }
    const exported: unknown = Reflect.get(uiComponents, name);
    if (exported instanceof LabIcon) {
      return exported;
    }
    console.warn(`Unknown icon '${name}' in ${TUTOR_MD_FILENAME}`);
    return undefined;
  }

  /**
   * Matches a Font Awesome class, e.g. `fa`, `far` or `fa-lightbulb`.
   */
  const FA_CLASS = /^fa[a-z0-9-]*$/;

  /**
   * Matches a Font Awesome style class, e.g. `fa`, `fas`, `far` or `fab`.
   */
  const FA_STYLE_CLASS = /^fa[a-z]?$/;

  /**
   * Returns the CSS classes of a Font Awesome icon, provided by JupyterLab.
   *
   * The `fa` style class is added if no style class is provided, so that
   * `fa-lightbulb` is displayed as `fa fa-lightbulb`.
   * @param value - The Font Awesome classes, separated by spaces
   * @returns The CSS classes, or undefined if they are not Font Awesome classes
   */
  export function resolveIconClass(
    value: string | undefined
  ): string | undefined {
    if (!value) {
      return undefined;
    }
    const classes = value.split(/\s+/);
    if (!classes.every(name => FA_CLASS.test(name))) {
      console.warn(
        `Invalid Font Awesome icon '${value}' in ${TUTOR_MD_FILENAME}`
      );
      return undefined;
    }
    if (!classes.some(name => FA_STYLE_CLASS.test(name))) {
      classes.unshift('fa');
    }
    return classes.join(' ');
  }
}
