"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/avisos";
import { SomenteLeitura } from "@/components/config/permissao-config";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { EscolhaCobrancaMateriais } from "@/components/orcamento/escolha-cobranca-materiais";
import { regraDeCobranca, type CobrancaMateriais } from "@/lib/orcamentos/materiais";
import { FormField, FormGrid, FormSection } from "@/components/ui/form-field";
import { DIAS_ALERTA_PEDIDO_PADRAO } from "@/lib/pedido-cliente/regra";
import { MSG_REGUA, lerRegua, reguaEfetiva, textoRegua } from "@/lib/pedido-cliente/lembretes";
import {
  GARANTIAS_PECAS_SUGERIDAS, GARANTIAS_SERVICO_SUGERIDAS, NaoInclusoCampo, NormasCampo,
} from "@/components/orcamento/campos-corporativos";

export interface PadroesOrcamentoTela {
  orcamentoValidadeDias: number;
  orcamentoGarantiaServico: string | null;
  orcamentoGarantiaPecas: string | null;
  orcamentoNaoIncluso: string | null;
  orcamentoNormas: string[];
  /** Leva D: padrão de "mostrar materiais" no documento do cliente */
  orcamentoMostrarMateriais?: boolean;
  /** "Orçamento E2": como a empresa cobra os materiais */
  orcamentoCobrancaMateriais?: string | null;
  /** Pedido do cliente: o sino avisa depois de tantos dias esperando */
  pedidoClienteDiasAlerta?: number;
  /** PC-2: lembretes por e-mail ao contato de compras e a régua (dias) */
  pedidoLembretesAtivo?: boolean;
  pedidoLembretesDias?: number[];
}

/**
 * Configurações › Orçamentos e propostas: o que o orçamento NOVO já traz preenchido (validade,
 * garantias, não incluso, normas e as opções do documento do cliente). Cada orçamento grava os seus e pode editar; mudar aqui não mexe
 * nos que já existem. Salvou: toast. Sem Configurações › gerenciar: só leitura, sem o botão Salvar.
 */
export function OrcamentoPadroesClient({ inicial, podeEditar }: { inicial: PadroesOrcamentoTela; podeEditar: boolean }) {
  const [validade, setValidade] = useState(String(inicial.orcamentoValidadeDias));
  const [garantiaServico, setGarantiaServico] = useState(inicial.orcamentoGarantiaServico ?? "");
  const [garantiaPecas, setGarantiaPecas] = useState(inicial.orcamentoGarantiaPecas ?? "");
  const [naoIncluso, setNaoIncluso] = useState(inicial.orcamentoNaoIncluso ?? "");
  const [normas, setNormas] = useState<string[]>(inicial.orcamentoNormas ?? []);
  const [mostrarMateriais, setMostrarMateriais] = useState(inicial.orcamentoMostrarMateriais !== false);
  const [cobranca, setCobranca] = useState<CobrancaMateriais>(regraDeCobranca(inicial.orcamentoCobrancaMateriais));
  const [diasPedido, setDiasPedido] = useState(String(inicial.pedidoClienteDiasAlerta ?? DIAS_ALERTA_PEDIDO_PADRAO));
  const [lembretes, setLembretes] = useState(inicial.pedidoLembretesAtivo !== false);
  const [regua, setRegua] = useState(reguaEfetiva(inicial.pedidoLembretesDias).join(", "));
  const reguaLida = lerRegua(regua);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const mudou = <T,>(f: (v: T) => void) => (v: T) => { f(v); setMsg(null); };

  async function salvar() {
    if (lembretes && !reguaLida) { setMsg(MSG_REGUA); return; }
    setSalvando(true); setMsg(null);
    try {
      const r = await fetch("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orcamentoValidadeDias: validade,
          orcamentoGarantiaServico: garantiaServico,
          orcamentoGarantiaPecas: garantiaPecas,
          orcamentoNaoIncluso: naoIncluso,
          orcamentoNormas: normas,
          orcamentoMostrarMateriais: mostrarMateriais,
          orcamentoCobrancaMateriais: cobranca,
          pedidoClienteDiasAlerta: diasPedido,
          pedidoLembretesAtivo: lembretes,
          ...(reguaLida ? { pedidoLembretesDias: reguaLida } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.erro ?? "Não foi possível salvar."); return; }
      toast("Padrões salvos. Valem para os próximos orçamentos.");
    } catch {
      setMsg("Sem conexão. Tente de novo.");
    } finally { setSalvando(false); }
  }

  return (
    <div className="bg-white rounded-card border border-surface-border p-6 space-y-8" data-padroes-orcamento>
      <fieldset disabled={!podeEditar} className="space-y-8 disabled:opacity-90">
        <FormSection title="Validade e garantias">
          <FormGrid cols={3}>
            <FormField label="Validade padrão (dias)" dica="A validade do novo orçamento é a data de criação somada a este número de dias. Pode ser alterada em cada orçamento.">
              <Input type="number" inputMode="numeric" min={1} max={365} value={validade} onChange={(e) => mudou(setValidade)(e.target.value)} data-validade-dias />
            </FormField>
            <FormField label="Garantia dos serviços" dica="Impressa nas Condições do orçamento.">
              <Input value={garantiaServico} onChange={(e) => mudou(setGarantiaServico)(e.target.value)} list="padrao-garantia-servico" maxLength={200} placeholder="Ex.: 90 dias" data-garantia-servico />
            </FormField>
            <FormField label="Garantia das peças" dica="Impressa nas Condições do orçamento.">
              <Input value={garantiaPecas} onChange={(e) => mudou(setGarantiaPecas)(e.target.value)} list="padrao-garantia-pecas" maxLength={200} placeholder="Ex.: Conforme garantia do fabricante" data-garantia-pecas />
            </FormField>
          </FormGrid>
          <datalist id="padrao-garantia-servico">{GARANTIAS_SERVICO_SUGERIDAS.map((v) => <option key={v} value={v} />)}</datalist>
          <datalist id="padrao-garantia-pecas">{GARANTIAS_PECAS_SUGERIDAS.map((v) => <option key={v} value={v} />)}</datalist>
        </FormSection>

        <FormSection title="Não incluso" dica="Itens listados como “Não incluso” em cada novo orçamento. Em branco, o bloco aparece apenas quando preenchido no orçamento.">
          <NaoInclusoCampo id="padrao-nao-incluso" valor={naoIncluso} onChange={mudou(setNaoIncluso)} />
        </FormSection>

        <FormSection title="Materiais" dica="Vale para os orçamentos e as OS novos; os que já existem ficam como nasceram. A peça vai sempre à parte. Em cada orçamento dá para trocar um item entre Material e Peça.">
          <div className="space-y-4" data-padroes-materiais>
            <FormField label="Como os materiais entram na cobrança">
              <EscolhaCobrancaMateriais valor={cobranca} onChange={mudou(setCobranca)} disabled={!podeEditar} />
            </FormField>
            {/* Cobrado à parte: os materiais já aparecem ao cliente em linha própria, com valor — a lista não se aplica */}
            {cobranca === "INCLUSO" && (
              <div data-padrao-mostrar-materiais>
                <ToggleSwitch
                  label="Mostrar a lista de materiais ao cliente"
                  description="Dentro de cada serviço, sem valor."
                  checked={mostrarMateriais} disabled={!podeEditar}
                  onChange={mudou(setMostrarMateriais)}
                />
              </div>
            )}
          </div>
        </FormSection>

        <FormSection title="Pedido do cliente" dica="Para os clientes que só pagam com o pedido deles (marcado na ficha do cliente). A OS que espera o pedido aparece no painel de pendências desde o primeiro dia; o sino avisa depois deste prazo, contado da conclusão da OS (no modo “para executar e faturar”, da aprovação).">
          <FormGrid cols={3}>
            <FormField label="Avisar no sino depois de (dias)">
              <Input type="number" inputMode="numeric" min={1} max={90} value={diasPedido} onChange={(e) => mudou(setDiasPedido)(e.target.value)} data-dias-pedido-cliente />
            </FormField>
          </FormGrid>
          <div className="mt-4 space-y-3" data-lembretes-pedido>
            <ToggleSwitch
              label="Lembrar o contato de compras por e-mail"
              description="Com a lista do que espera o pedido e o link do portal."
              dica="O e-mail vai ao contato de compras da ficha do cliente, que anexa o pedido de compra pelo portal. Cada cliente pode desligar na ficha (Cobrança e faturamento)."
              checked={lembretes} disabled={!podeEditar}
              onChange={mudou(setLembretes)}
            />
            {lembretes && (
              <FormGrid cols={3}>
                <FormField label="Enviar nos dias" hint={reguaLida ? `Após ${textoRegua(reguaLida)} de espera` : undefined} error={!reguaLida ? MSG_REGUA : undefined}
                  dica="Dias contados da conclusão da OS (no modo “para executar e faturar”, da aprovação). Cada etapa vai uma vez; o que já tem pedido, foi liberado ou está em conferência não entra.">
                  <Input value={regua} onChange={(e) => mudou(setRegua)(e.target.value)} placeholder="3, 7, 15" error={!reguaLida} data-regua-lembretes />
                </FormField>
              </FormGrid>
            )}
          </div>
        </FormSection>

        <FormSection title="Normas atendidas" dica="As normas marcadas vêm selecionadas em cada novo orçamento. Para orçamentos simples, deixe-as desmarcadas e selecione no orçamento quando necessário.">
          <NormasCampo valor={normas} onChange={mudou(setNormas)} />
        </FormSection>
      </fieldset>

      {msg && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3" data-erro-padroes-orcamento>{msg}</div>}
      {podeEditar ? (
        <div className="flex justify-end pt-2 border-t border-surface-linha">
          <Button onClick={salvar} loading={salvando} data-salvar-padroes-orcamento>Salvar padrões do orçamento</Button>
        </div>
      ) : (
        <SomenteLeitura />
      )}
    </div>
  );
}
