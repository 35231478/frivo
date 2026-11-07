"use client";

import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useCadastro } from "@/components/cadastros/seletor-cadastro";
import { LABEL_COMPORTAMENTO } from "@/lib/estoque/categoria";
import type { Comportamento } from "@/lib/estoque/categoria";

export interface FormDefinirCategoria { categoriaProdutoId: string | null | undefined }
export const FORM_CATEGORIA_VAZIO: FormDefinirCategoria = { categoriaProdutoId: undefined };
const NADA = "__";

/**
 * Formulário do "Definir categoria" em massa (produtos, E3.3 bônus): uma categoria ATIVA da empresa ou
 * "Sem categoria" (tira). Nada escolhido = o botão de confirmar fica desabilitado.
 */
export function FormDefinirCategoriaMassa({ valor, onChange }: { valor: FormDefinirCategoria; onChange: (v: FormDefinirCategoria) => void }) {
  const { itens, carregando } = useCadastro<{ id: string; nome: string; ativo?: boolean | null; comportamento?: string }>("categorias-produto");
  const atual = valor.categoriaProdutoId === undefined ? NADA : valor.categoriaProdutoId ?? "";
  return (
    <div data-form-definir-categoria>
      <FormField label="Categoria" required dica="A categoria diz como o produto entra na cobrança: Venda à parte (peça) ou Incluso no serviço (material). “Sem categoria” tira a categoria dos selecionados (eles passam a ser tratados como inclusos no serviço).">
        <Select name="categoriaProdutoId" value={atual} disabled={carregando} onChange={(e) => onChange({ categoriaProdutoId: e.target.value === NADA ? undefined : e.target.value || null })}>
          <option value={NADA}>{carregando ? "Carregando…" : "Escolha…"}</option>
          <option value="">Sem categoria (tirar a categoria)</option>
          {itens.filter((c) => c.ativo !== false).map((c) => (
            <option key={c.id} value={c.id}>{c.nome}{c.comportamento && LABEL_COMPORTAMENTO[c.comportamento as Comportamento] ? ` — ${LABEL_COMPORTAMENTO[c.comportamento as Comportamento]}` : ""}</option>
          ))}
        </Select>
      </FormField>
      {valor.categoriaProdutoId === undefined && <p className="mt-1 text-xs text-ink-muted">Escolha uma categoria ou “Sem categoria” para continuar.</p>}
    </div>
  );
}
