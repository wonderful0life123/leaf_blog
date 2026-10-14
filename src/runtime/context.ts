import { AsyncLocalStorage } from "node:async_hooks";
export const releaseContext = new AsyncLocalStorage<string>();
