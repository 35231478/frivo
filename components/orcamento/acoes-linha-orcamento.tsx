"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Mail, MessageCircle } from "lucide-react";
import { toast } from "@/components/ui/avisos";
import { cn } from "@/lib/utils";
import { abaPendente, pedirEnvio, resultadoEmail, SEM_WHATSAPP, type CanalEnvio } from "@/components/orcamento/envio-proposta";

interface Props {
  orcamentoId: string;
  codigo: string;
  tokenPublico: string;
  /** Pode enviar (permissão de editar orçamentos); sem ela, só o PDF */
  podeEnviar: boolean;
  /** Por que não dá para enviar agora (encerrado, validade vencida); null = pode */
  bloqueio?: string | null;
}

const botao = "inline-flex items-center justify-center w-8 h-8 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted disabled:cursor-not-allowed";

/**
 * Ações rápidas de cada linha da lista de orçamentos: baixar o PDF (a impressão do documento do
 * cliente), enviar por e-mail (Resend da empresa ao contato A/C) e por WhatsApp (wa.me com o link).
 * O envio usa a mesma rota da tela do orçamento: marca "Enviado" e entra na linha do tempo.
 */
export function AcoesLinhaOrcamento({ orcamentoId, codigo, tokenPublico, podeEnviar, bloqueio = null }: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<CanalEnvio | null>(null);

  async function enviar(canal: "EMAIL" | "WHATSAPP") {
    setEnviando(canal);
    const aba = canal === "WHATSAPP" ? abaPendente() : null;
    try {
      const { ok, dados } = await pedirEnvio(orcamentoId, canal);
      if (!ok) { aba?.fechar(); toast(dados.erro ?? "Não foi possível enviar.", "erro"); return; }
      if (canal === "EMAIL") {
        const r = resultadoEmail(dados);
        toast(r.msg, r.tipo === "ok" ? "sucesso" : "erro");
        if (r.abrirMailto && dados.mailtoUrl) window.location.href = dados.mailtoUrl;
      } else if (dados.whatsappUrl) {
        aba?.ir(dados.whatsappUrl);
      } else {
        aba?.fechar();
        toast(SEM_WHATSAPP, "erro");
      }
      router.refresh();
    } catch {
      aba?.fechar();
      toast("Erro de conexão.", "erro");
    } finally {
      setEnviando(null);
    }
  }

  const tituloEnvio = (acao: string) => bloqueio ?? `${acao} — ${codigo}`;
  return (
    <div className="flex items-center gap-0.5" data-acoes-linha={orcamentoId}>
      <a
        href={`/orcamento/${tokenPublico}/imprimir`}
        target="_blank"
        rel="noopener"
        className={botao}
        title={`Baixar PDF — ${codigo}`}
        aria-label={`Baixar PDF do orçamento ${codigo}`}
        data-baixar-pdf
      >
        <Download className="w-4 h-4" aria-hidden />
      </a>
      {podeEnviar && (
        <>
          <button
            type="button"
            className={botao}
            onClick={() => enviar("EMAIL")}
            disabled={!!bloqueio || enviando !== null}
            title={tituloEnvio("Enviar por e-mail")}
            aria-label={`Enviar o orçamento ${codigo} por e-mail`}
            data-enviar-email-linha
          >
            {enviando === "EMAIL" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Mail className="w-4 h-4" aria-hidden />}
          </button>
          <button
            type="button"
            className={cn(botao, "hover:text-ok")}
            onClick={() => enviar("WHATSAPP")}
            disabled={!!bloqueio || enviando !== null}
            title={tituloEnvio("Enviar por WhatsApp")}
            aria-label={`Enviar o orçamento ${codigo} por WhatsApp`}
            data-enviar-whatsapp-linha
          >
            {enviando === "WHATSAPP" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <MessageCircle className="w-4 h-4" aria-hidden />}
          </button>
        </>
      )}
    </div>
  );
}
