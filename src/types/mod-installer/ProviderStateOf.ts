import type { ModProvider } from "./ModProvider.ts";

export type ProviderStateOf<T> = T extends ModProvider<infer S> ? S : never;
