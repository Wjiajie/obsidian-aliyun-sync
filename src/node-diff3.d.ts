declare module "node-diff3" {
  export type MergeRegion<T> =
    | { ok: T[]; conflict?: never }
    | {
        ok?: never;
        conflict: {
          a: T[];
          aIndex: number;
          b: T[];
          bIndex: number;
          o: T[];
          oIndex: number;
        };
      };

  export function diff3Merge<T>(
    a: T[],
    o: T[],
    b: T[],
    options?: {
      excludeFalseConflicts?: boolean;
      stringSeparator?: string | RegExp;
    }
  ): MergeRegion<T>[];
}
