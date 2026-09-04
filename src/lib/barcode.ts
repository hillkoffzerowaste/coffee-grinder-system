import JsBarcode from "jsbarcode";

export function barcodeBits(value: string): string {
  if (!/^\d{1,32}$/.test(value)) throw new Error("Invalid numeric barcode");
  const result: { encodings?: { data: string }[] } = {};
  JsBarcode(result, value, { format: "CODE128", displayValue: false });
  return result.encodings!.map(item => item.data).join("");
}
