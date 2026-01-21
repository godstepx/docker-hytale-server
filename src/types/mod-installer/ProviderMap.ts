import type { ModProvider } from "./ModProvider.ts";
import type { ProviderStateOf } from "./ProviderStateOf.ts";

export type ProviderMap<TProviders extends Record<string, ModProvider<unknown>>> = {
  [K in keyof TProviders]: ProviderStateOf<TProviders[K]>;
};
