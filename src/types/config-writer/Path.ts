import type { Primitive } from "./Primitive.ts";

export type Path<T> = T extends Primitive
  ? never
  : {
      [K in Extract<keyof T, string>]: T[K] extends Primitive | Array<Primitive | object>
        ? K
        : K | `${K}.${Path<T[K]>}`;
    }[Extract<keyof T, string>];
