export async function fetchJson<T>(
  input: string,
  init: RequestInit,
): Promise<T> {
  const headers =
    init.body === undefined
      ? init.headers
      : {
          "content-type": "application/json",
          ...(init.headers ?? {}),
        };

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `Request failed with ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as T;
}
