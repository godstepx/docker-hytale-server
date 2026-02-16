export interface ModProvider<TState> {
  install: () => Promise<void>;
  getModDir: () => string;
  getStateEntry?: () => TState;
}
