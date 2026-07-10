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
