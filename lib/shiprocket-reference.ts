const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidValue(id: string): bigint {
  if (!UUID.test(id)) throw new Error("Invalid website order reference.");
  return BigInt(`0x${id.replace(/-/g, "")}`);
}

/** Full UUID encoded without truncation: 27 characters, within Quick's UI limit of 30. */
export function merchantOrderId(id: string): string {
  return `BI${uuidValue(id).toString(36).toUpperCase().padStart(25, "0")}`;
}

/** References used before the Quick dashboard's stricter length limit was supported. */
export function legacyMerchantOrderId(id: string): string {
  return uuidValue(id).toString();
}

/** Never change the reference of an existing or potentially accepted creation attempt. */
export function resolveMerchantOrderId(id: string, fulfillment: unknown): string {
  if (fulfillment === undefined || fulfillment === null) return merchantOrderId(id);
  if (typeof fulfillment === "object" && !Array.isArray(fulfillment)) {
    const reference = (fulfillment as Record<string, unknown>).merchantOrderId;
    if (typeof reference === "string" && reference.trim() && reference.length <= 50) {
      return reference;
    }
  }
  // Older attempts may not have saved their reference. They used the decimal
  // UUID, so reconciliation and retries must continue to use that same value.
  return legacyMerchantOrderId(id);
}
