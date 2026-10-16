// metadata.json is rewritten in place (not atomically), so a reader that
// lists budgets while another process saves one can see a truncated file.
// Re-read a few times before treating the file as corrupt; otherwise the
// budget briefly vanishes from the list and callers fail to resolve it.
export async function readJsonWithRetry<T>(
  read: () => Promise<string>,
  { attempts = 5, delayMs = 40 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let failure: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    try {
      return JSON.parse(await read()) as T;
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof Error ? failure : new Error(String(failure));
}
