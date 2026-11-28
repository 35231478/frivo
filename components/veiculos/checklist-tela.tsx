"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { ChecklistPreenchimento } from "@/components/veiculos/checklist-preenchimento";
import { ChecklistsPreenchidos } from "@/components/veiculos/checklists-preenchidos";
import { ChecklistDiario } from "@/components/veiculos/checklist-diario";
import { PERMISSAO_CHECKLIST, type ItemDoModelo } from "@/lib/veiculos/checklist";

type Aba = "preencher" | "preenchidos" | "diario";

interface Props {
  veiculos: { id: string; placa: string; modelo: string }[];
  templates: { id: string; nome: string; frequencia: string; itens: ItemDoModelo[] }[];
  colaboradores: { id: string; nome: string }[];
  veiculoInicial?: string;
  abaInicial?: string;
}

/**
 * A tela do checklist de veículo: preencher um novo e, para quem pode ver a frota (Veículos ›
 * visualizar), a aba dos preenchidos — com Detalhe, Editar e Excluir conforme a permissão.
 * Quem só preenche (Veículos › checklist, como o técnico em campo) continua vendo só o formulário.
 */
export function ChecklistTela({ veiculos, templates, colaboradores, veiculoInicial, abaInicial }: Props) {
  const { pode } = usePermissoes();
  const podePreencher = pode("veiculos", "checklist");
  const podeVer = pode(PERMISSAO_CHECKLIST.ver.modulo, PERMISSAO_CHECKLIST.ver.acao);
  // "Diário": o histórico do checklist obrigatório no app (o porteiro) — para quem vê a frota
  const abas: Aba[] = [...(podePreencher ? ["preencher" as const] : []), ...(podeVer ? ["preenchidos" as const, "diario" as const] : [])];
  const [aba, setAbaEstado] = useState<Aba>((abaInicial === "preenchidos" || abaInicial === "diario") && podeVer ? abaInicial : abas[0] ?? "preencher");
  // A aba vai para a URL (`?aba=`): cada aba tem os seus filtros lembrados (Preenchidos, Diário) e trocar de aba
  // começa da URL limpa da outra; um link com `?aba=` (o sino) com a tela aberta troca a aba
  const router = useRouter();
  const pathname = usePathname();
  const abaUrl = useSearchParams().get("aba");
  useEffect(() => {
    if (abaUrl && (abas as string[]).includes(abaUrl) && abaUrl !== aba) setAbaEstado(abaUrl as Aba);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaUrl]);
  const setAba = (a: Aba) => { setAbaEstado(a); if (a !== aba) router.replace(`${pathname}?aba=${a}`, { scroll: false }); };
  // A lista da aba só monta quando a URL já não é a da outra aba (os filtros de uma não vazam para a outra)
  const pronta = !abaUrl || abaUrl === aba;

  return (
    <div className="space-y-4" data-checklist-tela>
      {abas.length > 1 && (
        <div className="flex border-b border-surface-border" role="tablist" aria-label="Checklist de veículo">
          {abas.map((a) => (
            <button key={a} type="button" role="tab" aria-selected={aba === a} onClick={() => setAba(a)} data-aba-tela={a}
              className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                aba === a ? "border-primary-600 text-primary-700" : "border-transparent text-ink-muted hover:text-ink")}>
              {a === "preencher" ? "Preencher" : a === "preenchidos" ? "Preenchidos" : "Diário"}
            </button>
          ))}
        </div>
      )}
      {aba === "preencher" && podePreencher && (
        <div className="max-w-2xl">
          <ChecklistPreenchimento
            veiculos={veiculos} templates={templates} colaboradores={colaboradores} veiculoInicial={veiculoInicial}
            onVerPreenchidos={podeVer ? () => setAba("preenchidos") : undefined}
          />
        </div>
      )}
      {aba === "preenchidos" && podeVer && pronta && <ChecklistsPreenchidos colaboradores={colaboradores} />}
      {aba === "diario" && podeVer && pronta && <ChecklistDiario colaboradores={colaboradores} />}
      {abas.length === 0 && <p className="text-sm text-ink-muted" data-somente-leitura>Somente leitura: requer a permissão Veículos › checklist.</p>}
    </div>
  );
}
