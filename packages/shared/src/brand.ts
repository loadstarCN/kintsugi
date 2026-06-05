/**
 * Branded types: compile-time nominal typing for primitive-shaped IDs.
 * e.g. `TenantCode` is still a string at runtime, but the type system
 * won't let you pass a `UserId` where a `TenantCode` is expected.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantCode = Brand<string, 'TenantCode'>;
export type AppCode = Brand<string, 'AppCode'>;
export type DatasetCode = Brand<string, 'DatasetCode'>;
export type UserId = Brand<string, 'UserId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type SqlCode = Brand<string, 'SqlCode'>;
export type BffScriptId = Brand<string, 'BffScriptId'>;

export const brand = <T, B extends string>(value: T): Brand<T, B> => value as Brand<T, B>;
