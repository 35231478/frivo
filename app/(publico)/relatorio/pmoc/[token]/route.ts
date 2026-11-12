import { NextRequest } from "next/server";
import { gerarDocumento, respostaPdf } from "@/lib/pmoc-documento-server";

const indisponivel = () => new Response("Documento indisponível. Peça um novo link a quem enviou.", {
  status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
});

/**
 * Link público do documento do PMOC (o que vai ao cliente por WhatsApp ou e-mail). Quem tem o link
 * abre o PDF, sem login — por isso o token é longo e aleatório, e só vale enquanto o plano está
 * publicado e ativo: voltou para rascunho ou foi inativado, o link para de abrir.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return indisponivel();
  const pdf = await gerarDocumento({ tokenPublico: token });
  if (!pdf || !pdf.carregado.ativo || pdf.carregado.status !== "PUBLICADO") return indisponivel();
  return respostaPdf(pdf, true);
}
