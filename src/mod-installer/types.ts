export interface ModProvider<TState> {
  install: () => Promise<void>;
  getModDir: () => string;
  getStateEntry?: () => TState;
}

export type ProviderStateOf<T> = T extends ModProvider<infer S> ? S : never;
