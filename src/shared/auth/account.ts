export type AccountScope = string | null;

export interface AccountUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  hasPasskey: boolean;
}

export const accountQueryKey = (
  scope: AccountScope,
  kind: string,
  ...parts: readonly unknown[]
) => ['account', scope, kind, ...parts] as const;
