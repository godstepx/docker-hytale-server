import type { ProviderState } from "./ProviderState.ts";

export type ModState<TProviderMap extends Record<string, unknown> = Record<string, unknown>> = {
  providers: { [K in keyof TProviderMap]?: ProviderState<TProviderMap[K]> };
};
