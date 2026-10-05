"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/**
 * Inativar (soft-delete) / Reabrir uma OS, com confirmação.
 * - Inativar = a OS vira CANCELADA (nada é apagado). Exige `ordens.excluir`.
 *   O servidor bloqueia OS com medição vinculada e a mensagem aparece no modal.
 * - Reabrir = volta para ABERTA. Exige `ordens.editar`.
 * Sem a permissão correspondente, não renderiza nada.
 */
export function OsInativarBotao({
  osId, numero, status, variante = "botao", abrirAoMontar = false, onFechar, onAlterado, modo = "inativar", className,
}: {
  osId: string;
  numero: string;
  status: string;
  /** "oculto": só o modal (aberto via `abrirAoMontar`). */
  variante?: "icone" | "botao" | "oculto";
  /** Abre o modal direto (usado quando o usuário escolhe "Cancelada" no select de status). */
  abrirAoMontar?: boolean;
  onFechar?: () => void;
  onAlterado?: (novoStatus: string) => void;
  /** "recusar": recusa de solicitação do cliente (gaveta de Solicitações) — mesmo fluxo, textos próprios. */
  modo?: "inativar" | "recusar";
  className?: string;
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const recusar = modo === "recusar";
  const cancelada = !recusar && status === "CANCELADA";
  const permitido = cancelada ? pode("ordens", "editar") : pode("ordens", "excluir");

  const [aberto, setAberto] = useState(abrirAoMontar);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  if (!permitido) return null;

  function fechar() {
    setAberto(false); setErro(""); setMotivo("");
    onFechar?.();
  }

  async function confirmar() {
    setCarregando(true); setErro("");
    try {
      const res = cancelada
        ? await fetch(`/api/ordens/${osId}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ABERTA" }),
          })
        : await fetch(`/api/ordens/${osId}`, {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(recusar ? { motivo, recusa: true } : { motivo }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.erro ?? "Não foi possível concluir a ação."); return; }
      const novo = cancelada ? "ABERTA" : "CANCELADA";
      setAberto(false); setMotivo("");
      onAlterado?.(novo);
      onFechar?.();
      if (!recusar) router.refresh();
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setCarregando(false);
    }
  }

  const Icone = cancelada ? RotateCcw : Ban;
  const rotulo = recusar ? "Recusar solicitação" : cancelada ? "Reabrir OS" : "Inativar OS";

  return (
    <>
      {variante === "oculto" ? null : variante === "icone" ? (
        <button
          type="button" title={rotulo} onClick={() => setAberto(true)}
          className={cn("p-1.5 rounded-md hover:bg-surface-alt text-ink-muted", cancelada ? "hover:text-emerald-600" : "hover:text-red-600")}
        >
          <Icone className="w-4 h-4" />
        </button>
      ) : (
        <button
          type="button" onClick={() => setAberto(true)}
          className={cn(
            "inline-flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 transition-colors",
            cancelada ? "text-emerald-700 border-emerald-200 hover:bg-emerald-50" : "text-red-600 border-red-200 hover:bg-red-50",
            className,
          )}
        >
          <Icone className="w-4 h-4" /> {recusar ? "Recusar" : cancelada ? "Reabrir" : "Inativar"}
        </button>
      )}

      <Modal aberto={aberto} onFechar={fechar} titulo={recusar ? `Recusar a solicitação ${numero}?` : cancelada ? `Reabrir a OS ${numero}?` : `Inativar a OS ${numero}?`} tamanho="sm">
        <div className="space-y-4">
          {recusar ? (
            <>
              <p className="text-sm text-ink">
                Tem certeza? A solicitação será <strong>recusada</strong>: a OS vira <strong>Cancelada</strong> e o cliente
                passa a ver “Cancelada” no portal. Nada é apagado e ela pode ser reaberta depois pela própria OS.
              </p>
              <label className="block">
                <span className="block text-xs font-medium text-ink mb-1">Motivo (opcional — fica no histórico)</span>
                <textarea
                  value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500}
                  placeholder="Ex: fora da área de atendimento, serviço não prestado…"
                  className="w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 resize-none"
                />
              </label>
            </>
          ) : cancelada ? (
            <p className="text-sm text-ink">A OS volta para o status <strong>Aberta</strong> e reaparece nas listas e no calendário.</p>
          ) : (
            <>
              <p className="text-sm text-ink">
                Tem certeza? A OS será <strong>cancelada</strong> e sairá das listas e do calendário.
                Nada é apagado: atividades, anexos, relatórios e histórico ficam preservados, e ela pode ser reaberta depois.
              </p>
              <label className="block">
                <span className="block text-xs font-medium text-ink mb-1">Motivo (opcional — fica no histórico)</span>
                <textarea
                  value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500}
                  placeholder="Ex: OS aberta em duplicidade, cliente desistiu…"
                  className="w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 resize-none"
                />
              </label>
            </>
          )}
          {erro && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{erro}</span>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={fechar} className="px-4 py-2.5 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt">
              Voltar
            </button>
            <button
              type="button" onClick={confirmar} disabled={carregando}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg text-white disabled:opacity-60",
                cancelada ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700",
              )}
            >
              {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icone className="w-4 h-4" />}
              {recusar ? "Sim, recusar" : cancelada ? "Reabrir OS" : "Sim, inativar"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
