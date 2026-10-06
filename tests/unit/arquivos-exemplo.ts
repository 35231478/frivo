/** Arquivos mínimos (só o cabeçalho de cada formato) para os testes de anexos. */
const b = (...n: number[]) => Uint8Array.from(n);
const txt = (s: string) => new TextEncoder().encode(s);
const junta = (...partes: Uint8Array[]) => {
  const out = new Uint8Array(partes.reduce((t, p) => t + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};

export const PNG = junta(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), txt("resto-da-imagem"));
export const JPEG = junta(b(0xff, 0xd8, 0xff, 0xe0), txt("resto-da-imagem"));
export const WEBP = junta(txt("RIFF"), b(0, 0, 0, 0), txt("WEBPVP8 "));
export const HEIC = junta(b(0, 0, 0, 0x18), txt("ftypheic"), txt("resto"));
export const PDF = txt("%PDF-1.7\n%resto");
export const ZIP = junta(b(0x50, 0x4b, 0x03, 0x04), txt("resto"));
export const OLE = junta(b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), txt("resto"));
export const HTML = txt("<html><script>fetch('/api/usuarios')</script></html>");
export const SVG = txt('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

export const dataUrl = (tipo: string, bytes: Uint8Array) =>
  `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;
