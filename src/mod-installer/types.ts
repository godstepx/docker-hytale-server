export interface ModProvider {
  id: string;
  install: () => Promise<void>;
  getModDir: () => string;
}
