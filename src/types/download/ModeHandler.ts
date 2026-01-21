export interface ModeHandler {
  ensure: () => Promise<void>;
}
