import type { Metadata } from "next";
import { headers } from "next/headers";
import { AlertCircle, CalendarClock, FolderOpen } from "lucide-react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { conferirBloqueio, ipDaRequisicao, registrarTentativa } from "@/lib/acesso/limite";
import { ErroDocumentacao, MSG_LINK_INDISPONIVEL, abrirDocumentacao, type DocumentacaoPublica } from "@/lib/documentacao/pacote-server";
import { DocumentacaoPublicaLista } from "@/components/documentacao/documentacao-publica";
import { formatarData } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Documentação da equipe", robots: { index: false, follow: false } };

/**
 * O LINK da documentação da equipe: sem login, quem tem o token vê o pacote que a empresa montou
 * para ele — e só isso — e baixa tudo ou item a item.
 *
 * Link que não serve não mostra erro técnico. O que EXISTIU e não vale mais diz o motivo (expirou
 * em tal dia, foi desativado) e a quem pedir outro; o que nunca existiu recebe a frase genérica.
 * O limite por IP é o mesmo das rotas de download: só token recusado conta.
 */
export default async function DocumentacaoPublicaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const alvos = { ip: ipDaRequisicao(h) };

  let dados: DocumentacaoPublica | null = null;
  let recusa: string | null = null;
  let motivo: "EXPIRADO" | "REVOGADO" | "BLOQUEADO" | "INDISPONIVEL" = "INDISPONIVEL";

  const bloqueio = await conferirBloqueio("DOCUMENTACAO_PUBLICA", alvos);
  if (bloqueio.bloqueado) {
    recusa = `Muitas tentativas. Tente de novo em ${bloqueio.minutos} min.`;
    motivo = "BLOQUEADO";
  } else {
    try {
      dados = await abrirDocumentacao(token, { ip: alvos.ip, userAgent: h.get("user-agent") });
    } catch (e) {
      if (!(e instanceof ErroDocumentacao)) throw e;
      if (e.status === 404 || e.status === 410) await registrarTentativa("DOCUMENTACAO_PUBLICA", alvos);
      recusa = e.message;
      const m = (e.detalhe as { motivo?: string } | undefined)?.motivo;
      if (m === "EXPIRADO" || m === "REVOGADO") motivo = m;
    }
  }

  const TITULO = { EXPIRADO: "Link expirado", REVOGADO: "Link desativado", BLOQUEADO: "Aguarde um pouco", INDISPONIVEL: "Link indisponível" } as const;

  return (
    <div className="min-h-screen flex flex-col" data-pagina-documentacao={dados ? "ATIVO" : motivo}>
      <header className="bg-white border-b border-surface-border py-4 px-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <FrivoLogo size="sm" showSubtitle={false} variant="dark" />
          {dados && <span className="text-xs text-ink-muted truncate" data-documentacao-empresa>{dados.empresa.nome}</span>}
        </div>
      </header>

      <main className="flex-1 py-5 px-3 sm:px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {!dados ? (
            <section className="bg-white rounded-card shadow-card p-6 text-center space-y-3" data-documentacao-recusada>
              <div className="mx-auto w-12 h-12 rounded-full bg-atencao-claro flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-atencao-texto" aria-hidden />
              </div>
              <h1 className="font-display text-xl font-bold text-ink">{TITULO[motivo]}</h1>
              <p className="text-sm text-ink-muted" data-documentacao-motivo>{recusa ?? MSG_LINK_INDISPONIVEL}</p>
            </section>
          ) : (
            <>
              <section className="bg-white rounded-card shadow-card p-5 space-y-1" data-documentacao-cabecalho>
                <p className="text-xs uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                  <FolderOpen className="w-4 h-4" aria-hidden /> Documentação da equipe · {dados.empresa.nome}
                </p>
                <h1 className="font-display text-2xl font-bold text-ink" data-documentacao-cliente>{dados.cliente}</h1>
                <p className="text-sm text-ink-muted flex items-center gap-1.5" data-documentacao-validade>
                  <CalendarClock className="w-4 h-4" aria-hidden /> Disponível até {formatarData(dados.expiraEm)}
                </p>
              </section>
              <DocumentacaoPublicaLista token={token} dados={dados} />
            </>
          )}
        </div>
      </main>

      <footer className="py-4 px-4 text-center text-xs text-ink-subtle">
        Documentos de uso restrito, enviados para esta finalidade. Não compartilhe este link.
      </footer>
    </div>
  );
}
