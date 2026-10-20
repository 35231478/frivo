"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";

const CONFIRMAR_NOVO =
  "Gerar um novo link para este relatório?\n\nO link atual para de abrir na hora — quem já recebeu vai precisar do novo.";

/**
 * Ações do relatório público de uma atividade: abrir, copiar o link (já com o token) e gerar um
 * novo link (troca o token; o antigo passa a dar 404). Gerar novo link exige OS › editar.
 */
export function LinkRelatorioAtividade({
  osId, atividadeId, link, onNovoLink,
}: { osId: string; atividadeId: string; link: string; onNovoLink: (link: string) => void }) {
  const { pode } = usePermissoes();
  const [copiado, setCopiado] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function copiar() {
    const url = new URL(link, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      window.prompt("Copie o link do relatório:", url);
    }
  }

  async function gerarNovo() {
    if (!window.confirm(CONFIRMAR_NOVO)) return;
    setGerando(true); setMsg(null);
    try {
      const res = await fetch(`/api/ordens/${osId}/atividades/${atividadeId}/link-relatorio`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || typeof d.link !== "string") { setMsg({ tipo: "erro", texto: d.erro ?? "Não foi possível gerar o novo link." }); return; }
      onNovoLink(d.link);
      setMsg({ tipo: "ok", texto: "Novo link gerado. O anterior não abre mais." });
    } catch {
      setMsg({ tipo: "erro", texto: "Erro de conexão." });
    } finally {
      setGerando(false);
    }
  }

  const botao = "inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50";
  return (
    <div className="shrink-0 flex flex-col items-end gap-0.5" data-acoes-relatorio={atividadeId}>
      <a href={link} target="_blank" rel="noopener noreferrer" className={botao} data-ver-relatorio>
        <FileText className="w-3.5 h-3.5" /> Ver relatório <ExternalLink className="w-3 h-3" />
      </a>
      <button type="button" onClick={copiar} className={botao} data-copiar-link>
        {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copiado ? "Link copiado" : "Copiar link"}
      </button>
      {pode("ordens", "editar") && (
        <button type="button" onClick={gerarNovo} disabled={gerando} className={botao} data-novo-link
          title="Troca o link: o atual para de abrir">
          <RefreshCw className={`w-3.5 h-3.5 ${gerando ? "animate-spin" : ""}`} /> Novo link
        </button>
      )}
      {msg && (
        <p role="status" className={`text-[11px] max-w-[14rem] text-right ${msg.tipo === "ok" ? "text-success-700" : "text-red-700"}`}>{msg.texto}</p>
      )}
    </div>
  );
}
