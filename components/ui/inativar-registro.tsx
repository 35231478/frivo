"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, RotateCcw, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import type { Acao } from "@/lib/permissoes";

/**
 * Botão "Inativar / Reativar" com confirmação, para cadastros com soft-delete
 * (Orçamentos, Colaboradores, Equipes, Veículos).
 * - Ao abrir, consulta `${url}/impacto`: mostra o que bloqueia (e trava o botão)
 *   e o que será impactado, para a pessoa decidir com informação.
 * - Inativar = DELETE `${url}` com { motivo } (exige `modulo.excluir`).
 * - Reativar = PATCH `${url}` com { ativo: true } (exige `modulo.<acaoReativar>`).
 * Sem a permissão correspondente, não renderiza nada (o servidor também valida).
 */
export function InativarRegistro({
  url, modulo, acaoInativar = "excluir", acaoReativar, ativo, nome, entidade, variante = "icone",
  rotuloInativar = "Inativar", rotuloReativar = "Reativar", comMotivo = true,
  textoInativar, textoReativar, aoConcluir, feminino = false,
}: {
  url: string;
  modulo: string;
  /** Permissão de inativar (padrão "excluir"; cadastros de Configurações usam "gerenciar"). */
  acaoInativar?: Acao;
  acaoReativar: Acao;
  ativo: boolean;
  nome: string;
  /** "orçamento", "colaborador", "equipe", "veículo" */
  entidade: string;
  variante?: "icone" | "botao";
  rotuloInativar?: string;
  rotuloReativar?: string;
  comMotivo?: boolean;
  textoInativar?: string;
  textoReativar?: string;
  /** Depois de concluir (padrão: router.refresh()). */
  aoConcluir?: (ativo: boolean) => void;
  /** Concordância do texto padrão ("a equipe… ela pode ser reativada"). */
  feminino?: boolean;
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [impacto, setImpacto] = useState<{ bloqueio: string | null; avisos: string[] } | null>(null);
  const [checando, setChecando] = useState(false);

  const permitido = ativo ? pode(modulo, acaoInativar) : pode(modulo, acaoReativar);
  if (!permitido) return null;

  const rotulo = ativo ? rotuloInativar : rotuloReativar;
  const Icone = ativo ? Ban : RotateCcw;

  async function abrir(e?: React.MouseEvent) {
    e?.preventDefault(); e?.stopPropagation();
    setAberto(true); setErro(""); setMotivo(""); setImpacto(null);
    if (!ativo) return;
    setChecando(true);
    try {
      const res = await fetch(`${url}/impacto`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok && d) setImpacto(d);
      else setErro(d?.erro ?? "Não foi possível verificar os vínculos.");
    } catch { setErro("Erro de conexão."); } finally { setChecando(false); }
  }

  async function confirmar() {
    setCarregando(true); setErro("");
    try {
      const res = ativo
        ? await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo }) })
        : await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível concluir a ação."); return; }
      setAberto(false);
      if (aoConcluir) aoConcluir(!ativo); else router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }

  const bloqueado = !!impacto?.bloqueio;

  return (
    <>
      {variante === "icone" ? (
        <button
          type="button" title={`${rotulo} ${entidade}`} aria-label={`${rotulo} ${entidade}`} onClick={abrir}
          className={cn("p-1.5 rounded-md text-ink-muted hover:bg-surface-alt", ativo ? "hover:text-red-600" : "hover:text-emerald-600")}
        >
          <Icone className="w-4 h-4" />
        </button>
      ) : (
        <button
          type="button" onClick={abrir}
          className={cn(
            "inline-flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 transition-colors bg-white",
            ativo ? "text-red-600 border-red-200 hover:bg-red-50" : "text-emerald-700 border-emerald-200 hover:bg-emerald-50",
          )}
        >
          <Icone className="w-4 h-4" /> {rotulo}
        </button>
      )}

      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo={`${rotulo} ${entidade} ${nome}?`} tamanho="sm">
        <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-ink">
            {ativo
              ? (textoInativar ?? `Tem certeza? ${feminino ? "A" : "O"} ${entidade} sai das listas e dos seletores, mas nada é apagado: o histórico fica preservado e ${feminino ? "ela pode ser reativada" : "ele pode ser reativado"} depois.`)
              : (textoReativar ?? `${feminino ? "A" : "O"} ${entidade} volta a aparecer nas listas e nos seletores.`)}
          </p>

          {checando && <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Verificando vínculos…</p>}

          {impacto?.bloqueio && (
            <div data-bloqueio className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{impacto.bloqueio}</span>
            </div>
          )}
          {!bloqueado && !!impacto?.avisos.length && (
            <div data-avisos className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="flex items-center gap-1.5 font-semibold"><Info className="w-4 h-4" /> Antes de confirmar, saiba que:</p>
              <ul className="mt-1 ml-5 list-disc space-y-0.5">
                {impacto.avisos.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          )}

          {ativo && comMotivo && !bloqueado && (
            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1">Motivo (opcional — fica registrado nas observações)</span>
              <textarea
                value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500}
                placeholder="Ex: desligado da empresa, vendido, duplicado…"
                className="w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 resize-none"
              />
            </label>
          )}

          {erro && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{erro}</span>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setAberto(false)} className="px-4 py-2.5 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt">
              Voltar
            </button>
            <button
              type="button" onClick={confirmar} disabled={carregando || checando || bloqueado}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg text-white disabled:opacity-50",
                ativo ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icone className="w-4 h-4" />}
              {ativo ? `Sim, ${rotuloInativar.toLowerCase()}` : rotuloReativar}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
