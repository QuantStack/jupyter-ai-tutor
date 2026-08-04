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
 * Computes a line-by-line diff between initial starter code and current code.
 */
export function computeDiff(initial: string, current: string): string {
  if (initial.trim() === current.trim()) {
    return 'No changes made yet';
  }
  const initLines = initial.split('\n');
  const currLines = current.split('\n');
  const maxLen = Math.max(initLines.length, currLines.length);
  const diffLines: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const orig = initLines[i];
    const curr = currLines[i];
    if (orig !== curr) {
      if (orig !== undefined) {
        diffLines.push(`- ${orig}`);
      }
      if (curr !== undefined) {
        diffLines.push(`+ ${curr}`);
      }
    }
  }
  return diffLines.join('\n');
}
