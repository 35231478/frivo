"use client";

/**
 * Configurações › Checklists de veículo › "Checklist obrigatório no app": nos dias escolhidos, quem tem veículo padrão
 * só usa o app do técnico depois do checklist do veículo (ou de "Hoje não vou usar o veículo"). Por empresa:
 * ligar/desligar, dias da semana, o modelo usado e quem é obrigado (todos com veículo padrão, ou só os escolhidos).
 * Sem Configurações/Frota › gerenciar: só leitura.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { SIGLAS_DIAS, NOMES_DIAS, MSG_PORTEIRO_SEM_MODELO, type ConfigChecklistDiario } from "@/lib/checklist-diario/regras";

export function ChecklistDiarioConfig({ inicial, modelos, colaboradores, podeGerenciar }: {
  inicial: ConfigChecklistDiario;
  modelos: { id: string; nome: string }[];
  colaboradores: { id: string; nome: string; veiculo: string | null }[];
  podeGerenciar: boolean;
}) {
  const [c, setC] = useState<ConfigChecklistDiario>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const muda = (parte: Partial<ConfigChecklistDiario>) => { setErro(""); setC((a) => ({ ...a, ...parte })); };
  const bloqueado = !podeGerenciar;
  const comVeiculo = colaboradores.filter((x) => x.veiculo);

  async function salvar() {
    if (c.ativo && !c.templateId) { setErro(MSG_PORTEIRO_SEM_MODELO); return; }
    setSalvando(true);
    try {
      const r = await fetch("/api/checklist-diario/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErro(d?.erro ?? "Não foi possível salvar."); return; }
      setC(d);
      toast(d.ativo ? "Checklist obrigatório no app ligado." : "Configuração salva.");
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  return (
    <section className="bg-white rounded-card border border-surface-border p-4 sm:p-6 space-y-4 mb-6" aria-label="Checklist obrigatório no app" data-config-checklist-diario>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1 text-base font-semibold text-ink">
            Checklist obrigatório no app
            <Dica rotulo="Checklist obrigatório no app" texto="Ao abrir o app do técnico, nos dias escolhidos, a única tela do colaborador com veículo padrão é o checklist do veículo. Feito (ou “Hoje não vou usar o veículo”), o app libera até o próximo dia de checklist. Item com problema não trava: o checklist fica “Com alertas” e o sino avisa o gestor. Sem sinal, o checklist fica no aparelho e libera na hora; sobe quando o sinal voltar. O histórico fica em Veículos › Checklist › Diário." />
          </h2>
          <p className="text-sm text-ink-muted">Antes de começar o dia, o colaborador confere o veículo padrão dele.</p>
        </div>
      </div>

      <div data-diario-ativo>
        <ToggleSwitch label="Exigir o checklist do veículo ao abrir o app" checked={c.ativo} disabled={bloqueado} onChange={(v) => muda({ ativo: v })}
          description={c.ativo ? "Ligado: nos dias escolhidos, o app abre direto no checklist." : "Desligado: o app abre como sempre."} />
      </div>

      <fieldset className="space-y-2" disabled={bloqueado}>
        <legend className="text-sm font-medium text-ink">Dias com checklist</legend>
        <div className="flex flex-wrap gap-1.5" data-diario-dias>
          {SIGLAS_DIAS.map((sigla, d) => {
            const marcado = c.dias.includes(d);
            return (
              <button key={d} type="button" aria-pressed={marcado} title={NOMES_DIAS[d]} data-dia={d}
                onClick={() => muda({ dias: marcado ? c.dias.filter((x) => x !== d) : [...c.dias, d].sort((a, b) => a - b) })}
                className={cn("min-w-12 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60",
                  marcado ? "border-acento bg-acento text-white" : "border-surface-border bg-white text-ink-muted hover:bg-surface-alt")}>
                {sigla}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block space-y-1 max-w-md">
        <span className="text-sm font-medium text-ink">Modelo de checklist</span>
        <Select value={c.templateId ?? ""} disabled={bloqueado} onChange={(e) => muda({ templateId: e.target.value || null })} data-diario-modelo>
          <option value="">Selecione</option>
          {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </Select>
      </label>

      <fieldset className="space-y-2" disabled={bloqueado}>
        <legend className="text-sm font-medium text-ink">Quem faz</legend>
        <div className="flex flex-col gap-1.5 text-sm" data-diario-quem>
          <label className="inline-flex items-center gap-2"><input type="radio" name="quem-diario" checked={c.todos} onChange={() => muda({ todos: true })} data-diario-todos /> Todos com veículo padrão ({comVeiculo.length})</label>
          <label className="inline-flex items-center gap-2"><input type="radio" name="quem-diario" checked={!c.todos} onChange={() => muda({ todos: false })} data-diario-escolhidos /> Só os escolhidos</label>
        </div>
        {!c.todos && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 rounded-lg border border-surface-border p-2 text-sm" data-diario-colaboradores>
            {colaboradores.map((x) => (
              <li key={x.id}>
                <label className={cn("flex items-center gap-2 rounded px-1.5 py-1", !x.veiculo && "text-ink-subtle")}>
                  <input type="checkbox" checked={c.tecnicos.includes(x.id)} data-diario-colaborador={x.id}
                    onChange={(e) => muda({ tecnicos: e.target.checked ? [...c.tecnicos, x.id] : c.tecnicos.filter((t) => t !== x.id) })} />
                  <span className="min-w-0 truncate">{x.nome}</span>
                  <span className="ml-auto font-mono text-xs text-ink-muted">{x.veiculo ?? "sem veículo padrão"}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-muted">Quem não tem veículo padrão (ou está com o veículo em manutenção) não vê o checklist.</p>
      </fieldset>

      {erro && <p role="alert" className="rounded-lg bg-atrasado-claro px-3 py-2 text-sm text-atrasado-texto" data-erro-config-diario>{erro}</p>}
      {podeGerenciar
        ? <div className="flex justify-end border-t border-surface-linha pt-3"><Button onClick={salvar} loading={salvando} data-salvar-config-diario>Salvar</Button></div>
        : <p className="text-xs text-ink-muted">Somente leitura: requer Configurações ou Frota › gerenciar.</p>}
    </section>
  );
}
