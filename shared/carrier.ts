export const CARRIER_TEMPLATES = {
  DHL: "https://www.dhl.com/global-en/home/tracking.html?tracking-id={tracking}",
  UPS: "https://www.ups.com/track?tracknum={tracking}",
  FEDEX: "https://www.fedex.com/fedextrack/?trknbr={tracking}",
  ARAMEX: "https://www.aramex.com/track/results?ShipmentNumber={tracking}",
  TNT: "https://www.tnt.com/express/en_us/site/tracking.html?searchType=con&cons={tracking}",
} as const;

export type CarrierCode = keyof typeof CARRIER_TEMPLATES;

export function isCarrierCode(value: string): value is CarrierCode {
  return value.toUpperCase() in CARRIER_TEMPLATES;
}

export function carrierTrackingUrl(
  carrier: string,
  trackingNumber: string,
): string | null {
  const code = carrier.toUpperCase();
  if (!isCarrierCode(code)) return null;
  const tracking = trackingNumber.trim();
  if (!/^[A-Z0-9][A-Z0-9-]{3,39}$/i.test(tracking)) return null;
  return CARRIER_TEMPLATES[code].replace("{tracking}", encodeURIComponent(tracking));
}
