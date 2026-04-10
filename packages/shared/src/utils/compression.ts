import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

export function compress(str: string): string {
  try {
    return compressToEncodedURIComponent(str);
  } catch {
    return "";
  }
}

export function decompress(encoded: string): string {
  try {
    return decompressFromEncodedURIComponent(encoded) ?? "";
  } catch {
    return "";
  }
}
