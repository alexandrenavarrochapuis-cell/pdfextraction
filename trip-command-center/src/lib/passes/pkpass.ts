// Apple Wallet pass (.pkpass) reader: a zip holding pass.json. Pulls the
// barcode and the boarding details airlines put in the pass fields.

import { strFromU8, unzipSync } from "fflate";

export interface WalletPass {
  barcodeMessage: string | null;
  barcodeFormat: string | null; // bwip-js id
  organization: string | null;
  relevantDate: string | null;
  seat: string | null;
  gate: string | null;
  boardingGroup: string | null;
  boardingTime: string | null;
  passengerName: string | null;
  fields: { label: string; value: string }[];
}

const FORMAT: Record<string, string> = {
  PKBarcodeFormatQR: "qrcode",
  PKBarcodeFormatPDF417: "pdf417",
  PKBarcodeFormatAztec: "azteccode",
  PKBarcodeFormatCode128: "code128",
};

interface PassField {
  key?: string;
  label?: string;
  value?: unknown;
}

export function readPkpass(bytes: Uint8Array): WalletPass | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === "pass.json" });
  } catch {
    return null;
  }
  const raw = files["pass.json"];
  if (!raw) return null;
  let pass: Record<string, unknown>;
  try {
    pass = JSON.parse(strFromU8(raw).replace(/^﻿/, ""));
  } catch {
    return null;
  }
  const barcodes = (pass.barcodes as { message?: string; format?: string }[] | undefined) ?? [];
  const barcode = barcodes[0] ?? (pass.barcode as { message?: string; format?: string } | undefined);
  const style = (pass.boardingPass ?? pass.eventTicket ?? pass.generic) as Record<string, PassField[]> | undefined;
  const fields: { key: string; label: string; value: string }[] = [];
  for (const group of ["headerFields", "primaryFields", "secondaryFields", "auxiliaryFields", "backFields"]) {
    for (const f of style?.[group] ?? []) {
      if (f.value === undefined || f.value === null) continue;
      fields.push({ key: f.key ?? "", label: f.label ?? f.key ?? "", value: String(f.value) });
    }
  }
  const find = (re: RegExp) => fields.find((f) => re.test(f.key) || re.test(f.label))?.value ?? null;
  return {
    barcodeMessage: barcode?.message ?? null,
    barcodeFormat: barcode?.format ? FORMAT[barcode.format] ?? null : null,
    organization: typeof pass.organizationName === "string" ? pass.organizationName : null,
    relevantDate: typeof pass.relevantDate === "string" ? pass.relevantDate : null,
    seat: find(/seat/i),
    gate: find(/gate/i),
    boardingGroup: find(/group|zone/i),
    boardingTime: find(/board(ing)?[\s_-]?time|boards/i),
    passengerName: find(/passenger|name/i),
    fields: fields.map(({ label, value }) => ({ label, value })),
  };
}
