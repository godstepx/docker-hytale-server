export interface DeepPatch<T> {
  [key: string]: T | DeepPatch<T>;
}
