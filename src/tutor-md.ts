import { PathExt } from '@jupyterlab/coreutils';
import { Contents } from '@jupyterlab/services';

/**
 * The name of the file used as system prompt.
 */
export const TUTOR_MD_FILENAME = 'TUTOR.md';

/**
 * A TUTOR.md found in the file tree.
 */
export interface ITutorMd {
  /**
   * The TUTOR.md content, used as system prompt.
   */
  content: string;
  /**
   * The TUTOR.md path, as understood by the contents manager.
   */
  path: string;
}

/**
 * Looks for a TUTOR.md file in the file tree, walking up from the notebook
 * directory to the root of its drive.
 * @param contents - The contents manager used to browse the file tree
 * @param notebookPath - Path of the notebook, as understood by the contents manager
 * @returns The first TUTOR.md found, or null if none is available
 */
export async function findTutorMd(
  contents: Contents.IManager,
  notebookPath: string
): Promise<ITutorMd | null> {
  // Keep the drive prefix, if any, to browse the same drive as the notebook.
  const driveName = contents.driveName(notebookPath);
  const withDrive = (localPath: string): string =>
    driveName ? `${driveName}:${localPath}` : localPath;

  let directory = PathExt.dirname(contents.localPath(notebookPath));
  while (true) {
    const tutorMd = await readTutorMdFromDirectory(
      contents,
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
 * @param contents - The contents manager used to browse the file tree
 * @param directory - Path of the directory, as understood by the contents manager
 * @returns The TUTOR.md of the directory, or null if it does not contain one
 */
async function readTutorMdFromDirectory(
  contents: Contents.IManager,
  directory: string
): Promise<ITutorMd | null> {
  let listing: Contents.IModel;
  try {
    listing = await contents.get(directory, {
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
    const file = await contents.get(entry.path, {
      type: 'file',
      format: 'text',
      content: true
    });
    if (typeof file.content !== 'string') {
      return null;
    }
    return { path: file.path, content: file.content.trim() };
  } catch (err) {
    console.warn(`Failed to read '${entry.path}':`, err);
    return null;
  }
}
