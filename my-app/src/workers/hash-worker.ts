/// <reference lib="webworker" />

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ data: string; iterations: number }>) => {
  const { data, iterations } = event.data;

  let hash = new TextEncoder().encode(data);
  for (let i = 0; i < iterations; i++) {
    hash = sha256(hash);
  }

  self.postMessage({ hash: bytesToHex(hash) });
};
