// v2.81: the PDF reader must work on the Node version of the container (20).
// pdfjs-dist 6 needs Promise.withResolvers (Node 22+); without the fallback in
// extractPdfText every approval certificate failed to open on the server.
// Run: npx tsx tools/test_pdf_reader.ts
import assert from "node:assert/strict";
import { extractPdfText } from "../src/lib/cc.server";

/** A one-page PDF with one line of text, xref offsets computed. */
function tinyPdf(line: string): ArrayBuffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "", // content stream, filled below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 72 760 Td (${line}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new TextEncoder().encode(out);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const text = await extractPdfText(tinyPdf("7. Security certificate: ANSSI-CC-2022/38"));
assert.match(text, /Security certificate: ANSSI-CC-2022\/38/);
console.log(`pdf-reader: ok (node ${process.versions.node})`);
