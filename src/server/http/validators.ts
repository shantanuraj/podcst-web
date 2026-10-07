export function validEtag(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 1024 &&
    /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)
  );
}

export function validLastModified(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    new Date(value).toUTCString() === value &&
    Number.isFinite(Date.parse(value))
  );
}
