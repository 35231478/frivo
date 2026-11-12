"use client";

import { useState } from "react";
import { Check, Eye, FileText, Lock, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { cn } from "@/lib/utils";
import {
  CONFIG_RELATORIO_PADRAO, mostraSecao, SECOES_RELATORIO, type ConfigRelatorioOs, type SecaoRelatorioId,
} from "@/lib/relatorio-os/config";

/**
 * Configuração de impressão da OS: liga/desliga cada seção do relatório e escolhe quem vê —
 * "Cliente vê" (sai na versão do cliente e na interna) ou "Só interno" (só na versão interna).
 * Sem permissão de gerenciar: só leitura.
 */
export function ImpressaoOsClient({ inicial, podeEditar }: { inicial: ConfigRelatorioOs; podeEditar: boolean }) {
  const [cfg, setCfg] = useState<ConfigRelatorioOs>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const mudar = (id: SecaoRelatorioId, parte: Partial<ConfigRelatorioOs[SecaoRelatorioId]>) => {
    setCfg((c) => ({ ...c, [id]: { ...c[id], ...parte } }));
    setMsg(null);
  };
  const conta = (v: "cliente" | "interna") => SECOES_RELATORIO.filter((s) => mostraSecao(cfg, s.id, v)).length;

  async function salvar() {
    setSalvando(true); setMsg(null);
    try {
      const r = await fetch("/api/configuracoes/impressao-os", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? { tipo: "ok", texto: "Configuração salva. Vale para os próximos relatórios abertos ou impressos." } : { tipo: "erro", texto: j.erro ?? "Não foi possível salvar." });
    } catch {
      setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-resumo-versoes>
        <div className="card p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary-50"><Eye className="w-4 h-4 text-primary-600" /></div>
          <div>
            <p className="text-sm font-semibold text-ink">Versão do cliente</p>
            <p className="text-xs text-ink-muted">Link público e PDF enviados ao cliente · <strong data-conta="cliente">{conta("cliente")}</strong> seções + cabeçalho</p>
          </div>
        </div>
        <div className="card p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-surface-linha"><Lock className="w-4 h-4 text-ink-muted" /></div>
          <div>
            <p className="text-sm font-semibold text-ink">Versão interna</p>
            <p className="text-xs text-ink-muted">Só para quem tem login (aba Relatórios da OS) · <strong data-conta="interna">{conta("interna")}</strong> seções + cabeçalho</p>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border bg-surface-alt/40 flex items-center gap-2 text-sm">
          <FileText className="w-4 h-4 text-ink-muted" />
          <span className="font-semibold text-ink">Cabeçalho</span>
          <Dica texto="Empresa, número da OS, tipo, situação e datas. Impresso sempre, nas duas versões." rotulo="Cabeçalho" lado="direita" />
        </div>
        <ul className="divide-y divide-surface-border">
          {SECOES_RELATORIO.map((s) => {
            const c = cfg[s.id];
            return (
              <li key={s.id} data-secao={s.id} className={cn("px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3", !c.ativo && "bg-surface-alt/40")}>
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <button
                    type="button" role="switch" aria-checked={c.ativo} aria-label={`Incluir ${s.label}`} disabled={!podeEditar}
                    onClick={() => mudar(s.id, { ativo: !c.ativo })}
                    className={cn("relative mt-0.5 inline-flex h-[22px] w-[40px] shrink-0 rounded-full transition-colors disabled:opacity-60", c.ativo ? "bg-success-500" : "bg-surface-border")}
                  >
                    <span className={cn("inline-block h-[18px] w-[18px] mt-[2px] rounded-full bg-white shadow transition-transform", c.ativo ? "translate-x-[20px]" : "translate-x-[2px]")} />
                  </button>
                  <div className="min-w-0">
                    <p className={cn("text-sm font-semibold", c.ativo ? "text-ink" : "text-ink-muted line-through")}>{s.label}</p>
                    <p className="text-xs text-ink-muted">{s.dica}</p>
                  </div>
                </div>
                <div role="radiogroup" aria-label={`Quem vê ${s.label}`} className={cn("grid grid-cols-2 gap-1 p-1 bg-surface-alt rounded-lg sm:w-64 shrink-0", !c.ativo && "opacity-50")}>
                  {([[true, "Cliente vê", Eye], [false, "Só interno", Lock]] as const).map(([v, rot, Icone]) => (
                    <button
                      key={rot} type="button" role="radio" aria-checked={c.cliente === v} disabled={!podeEditar || !c.ativo}
                      onClick={() => mudar(s.id, { cliente: v })} data-quem={v ? "cliente" : "interno"}
                      className={cn("inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors",
                        c.cliente === v ? (v ? "bg-white text-primary-700 shadow-sm" : "bg-white text-ink shadow-sm") : "text-ink-muted hover:text-ink")}
                    ><Icone className="w-3.5 h-3.5" /> {rot}</button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-xs text-ink-muted flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" /> Seções desligadas não são impressas; seções sem dados na OS são omitidas.</p>

      {msg && <p role={msg.tipo === "erro" ? "alert" : "status"} className={cn("text-sm font-medium flex items-center gap-1.5", msg.tipo === "ok" ? "text-success-700" : "text-atrasado")}>{msg.tipo === "ok" && <Check className="w-4 h-4" />}{msg.texto}</p>}
      {podeEditar ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => { setCfg(CONFIG_RELATORIO_PADRAO); setMsg(null); }}>Restaurar padrão</Button>
          <Button type="button" onClick={salvar} loading={salvando}>Salvar</Button>
        </div>
      ) : (
        <p className="text-sm text-ink-muted" data-somente-leitura>Somente leitura: requer a permissão Configurações › Gerenciar.</p>
      )}
    </div>
  );
}
