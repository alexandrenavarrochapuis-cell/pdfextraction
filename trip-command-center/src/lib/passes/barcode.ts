// Render a boarding pass barcode as SVG on the server (no client library).

import "server-only";
import bwipjs from "bwip-js/node";

const SCALE: Record<string, number> = { pdf417: 3, qrcode: 6, azteccode: 6, code128: 3 };

export function barcodeSvg(message: string, format: string | null): string | null {
  const bcid = format && SCALE[format] ? format : "pdf417"; // BCBP default
  try {
    return bwipjs.toSVG({ bcid, text: message, scale: SCALE[bcid], paddingwidth: 4, paddingheight: 4, backgroundcolor: "FFFFFF" });
  } catch {
    return null;
  }
}
