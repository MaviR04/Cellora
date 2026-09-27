import type { ProductDetail } from "@da2/shared";

// Each product kind has different attributes (flexible schema), so the spec table is built
// per kind. Missing fields are simply skipped.
type Row = [label: string, value: unknown];

const yesNo = (v: unknown) => (v === undefined ? undefined : v ? "Yes" : "No");
const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(", ") : undefined);
const upper = (v: unknown) => (Array.isArray(v) && v.length ? v.map((x) => String(x).toUpperCase()).join(", ") : undefined);
const titleCase = (v: unknown) => (typeof v === "string" ? v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : undefined);

export function specRows(p: ProductDetail): [string, string][] {
  const a = p as Record<string, any>;
  const rows: Row[] = (() => {
    switch (p.kind) {
      case "phone":
        return [
          ["Chipset", a.chipset],
          ["RAM", a.ramGb && `${a.ramGb} GB`],
          ["Display", a.display && `${a.display.sizeIn}" ${a.display.panel}, ${a.display.refreshHz}Hz`],
          ["Main camera", a.cameras?.mainMp && `${a.cameras.mainMp} MP`],
          ["Ultra-wide", a.cameras?.ultraWideMp && `${a.cameras.ultraWideMp} MP`],
          ["Telephoto", a.cameras?.telephotoMp && `${a.cameras.telephotoMp} MP`],
          ["Battery", a.batteryMah && `${a.batteryMah.toLocaleString()} mAh`],
          ["Max charging", a.maxChargingW && `${a.maxChargingW} W`],
          ["Wireless charging", yesNo(a.wirelessCharging)],
          ["Port", a.port?.toUpperCase()],
          ["OS", a.os === "ios" ? "iOS" : "Android"],
          ["Released", a.releaseYear],
        ];
      case "case":
        return [["Style", titleCase(a.style)], ["Material", a.material], ["MagSafe", yesNo(a.magsafe)]];
      case "screen_protector":
        return [["Type", titleCase(a.material)], ["Pack", a.packCount && `${a.packCount} piece${a.packCount > 1 ? "s" : ""}`]];
      case "charging":
        return [
          ["Type", titleCase(a.subType)],
          ["Power", a.wattage && `${a.wattage} W`],
          ["Ports", upper(a.ports)],
          ["Connectors", a.connectors && `${a.connectors.from.toUpperCase()} to ${a.connectors.to.toUpperCase()}`],
          ["Length", a.lengthM && `${a.lengthM} m`],
          ["Protocols", list(a.protocols)],
        ];
      case "audio":
        return [
          ["Form factor", titleCase(a.formFactor)],
          ["Noise cancelling", yesNo(a.anc)],
          ["Battery", a.batteryHours && `${a.batteryHours} h`],
          ["Codecs", list(a.codecs)],
        ];
      case "power_bank":
        return [
          ["Capacity", a.capacityMah && `${a.capacityMah.toLocaleString()} mAh`],
          ["Max output", a.maxOutputW && `${a.maxOutputW} W`],
          ["Ports", upper(a.ports)],
          ["Wireless", yesNo(a.wireless)],
        ];
      case "smartwatch":
        return [
          ["Works with", a.compatiblePlatforms?.map((x: string) => (x === "ios" ? "iPhone" : "Android")).join(", ")],
          ["Case sizes", a.caseSizesMm && a.caseSizesMm.map((x: number) => `${x}mm`).join(", ")],
          ["GPS", yesNo(a.gps)],
          ["LTE", yesNo(a.lte)],
          ["Battery", a.batteryDays && `${a.batteryDays} days`],
          ["Sensors", a.sensors?.map((s: string) => titleCase(s)).join(", ")],
        ];
      default:
        return [];
    }
  })();
  return rows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([l, v]) => [l, String(v)]);
}
