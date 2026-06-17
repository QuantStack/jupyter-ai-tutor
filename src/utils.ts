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
