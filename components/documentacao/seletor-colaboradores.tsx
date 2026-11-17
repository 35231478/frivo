"use client";

import { UserMinus } from "lucide-react";
import { BuscaSelect } from "@/components/ui/busca-select";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";

export type MotivoColaborador = "CONTRATO" | "ATENDEU" | "EQUIPE" | "MANUAL";
export interface ColaboradorDoPacote { id: string; nome: string; motivo: MotivoColaborador }

/** Por que a pessoa apareceu na lista — a tela nunca sugere alguém sem dizer de onde veio. */
export const ROTULO_MOTIVO: Record<MotivoColaborador, string> = {
  CONTRATO: "Técnico do contrato",
  ATENDEU: "Atendeu nos últimos 12 meses",
  EQUIPE: "Da equipe",
  MANUAL: "Acrescentado",
};

/**
 * QUEM ENTRA NO PACOTE. A lista vem sugerida (quem atende o cliente) e já marcada; a pessoa tira
 * quem não vai, puxa uma equipe inteira ou acrescenta alguém pelo nome. O pacote leva quem estiver
 * marcado — a sugestão é só o ponto de partida.
 */
export function SeletorColaboradores({
  pessoas, marcados, onMarcados, equipes, todos, onPuxarEquipe, onAcrescentar, carregando, desabilitado,
}: {
  pessoas: ColaboradorDoPacote[];
  marcados: string[];
  onMarcados: (ids: string[]) => void;
  equipes: { id: string; nome: string }[];
  todos: { id: string; nome: string }[];
  onPuxarEquipe: (equipeId: string) => void;
  onAcrescentar: (pessoa: { id: string; nome: string }) => void;
  carregando?: boolean;
  desabilitado?: boolean;
}) {
  const marcado = new Set(marcados);
  const naLista = new Set(pessoas.map((p) => p.id));
  const alternar = (id: string) => onMarcados(marcado.has(id) ? marcados.filter((m) => m !== id) : [...marcados, id]);
  const todosMarcados = pessoas.length > 0 && pessoas.every((p) => marcado.has(p.id));

  return (
    <div className="space-y-3" data-seletor-colaboradores>
      {carregando ? (
        <p className="text-sm text-ink-muted" data-colaboradores-carregando>Procurando quem atende este cliente…</p>
      ) : pessoas.length === 0 ? (
        <p className="text-sm text-ink-muted bg-surface-alt border border-surface-border rounded-lg px-3 py-2.5" data-colaboradores-vazio>
          Ninguém atendeu este cliente nos últimos 12 meses. Puxe uma equipe ou acrescente os colaboradores pelo nome.
        </p>
      ) : (
        <div className="border border-surface-border rounded-lg bg-white overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-surface-linha bg-surface-alt/60">
            <span className="text-xs font-semibold text-ink-muted" data-colaboradores-contagem>
              {marcados.filter((m) => naLista.has(m)).length} de {pessoas.length} no pacote
            </span>
            <button
              type="button" disabled={desabilitado} data-marcar-todos
              onClick={() => onMarcados(todosMarcados ? [] : pessoas.map((p) => p.id))}
              className="text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
            >
              {todosMarcados ? "Desmarcar todos" : "Marcar todos"}
            </button>
          </div>
          <ul className="divide-y divide-surface-linha max-h-72 overflow-y-auto">
            {pessoas.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-alt/50">
                  <input
                    type="checkbox" checked={marcado.has(p.id)} disabled={desabilitado} onChange={() => alternar(p.id)}
                    data-colaborador={p.id} data-motivo={p.motivo}
                    className="w-4 h-4 rounded border-surface-border text-acento focus:ring-acento"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink truncate">{p.nome}</span>
                    <span className="block text-xs text-ink-muted">{ROTULO_MOTIVO[p.motivo]}</span>
                  </span>
                  {!marcado.has(p.id) && <UserMinus className="w-4 h-4 text-ink-subtle shrink-0" aria-label="Fora do pacote" />}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {equipes.length > 0 && (
          <FormField label="Puxar uma equipe">
            <Select value="" disabled={desabilitado || carregando} data-puxar-equipe onChange={(e) => { if (e.target.value) onPuxarEquipe(e.target.value); }}>
              <option value="">Escolher a equipe…</option>
              {equipes.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </Select>
          </FormField>
        )}
        <FormField label="Acrescentar colaborador">
          <BuscaSelect
            value="" placeholder="Pesquisar pelo nome…" disabled={desabilitado || carregando} rotulo="Acrescentar colaborador"
            atributos={{ "data-acrescentar-colaborador": true }}
            options={todos.filter((t) => !naLista.has(t.id)).map((t) => ({ value: t.id, label: t.nome }))}
            onChange={(id) => { const p = todos.find((t) => t.id === id); if (p) onAcrescentar(p); }}
          />
        </FormField>
      </div>
    </div>
  );
}
