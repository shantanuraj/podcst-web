export const removeIth = <T>(array: T[], index: number): T[] => {
  return index >= 0 && index < array.length ? [...array.slice(0, index), ...array.slice(index + 1)] : array;
};
