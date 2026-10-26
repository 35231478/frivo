"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormGrid, FormSection } from "@/components/ui/form-field";
import {
  GARANTIAS_PECAS_SUGERIDAS, GARANTIAS_SERVICO_SUGERIDAS, NaoInclusoCampo, NormasCampo,
} from "@/components/orcamento/campos-corporativos";

export interface PadroesOrcamentoTela {
  orcamentoValidadeDias: number;
  orcamentoGarantiaServico: string | null;
  orcamentoGarantiaPecas: string | null;
  orcamentoNaoIncluso: string | null;
  orcamentoNormas: string[];
}

/**
 * Configurações › Orçamentos e propostas: o que o orçamento NOVO já traz preenchido (validade,
 * garantias, não incluso e normas). Cada orçamento grava os seus e pode editar; mudar aqui não mexe
 * nos que já existem. Sem permissão de gerenciar: só leitura.
 */
export function OrcamentoPadroesClient({ inicial, podeEditar }: { inicial: PadroesOrcamentoTela; podeEditar: boolean }) {
  const [validade, setValidade] = useState(String(inicial.orcamentoValidadeDias));
  const [garantiaServico, setGarantiaServico] = useState(inicial.orcamentoGarantiaServico ?? "");
  const [garantiaPecas, setGarantiaPecas] = useState(inicial.orcamentoGarantiaPecas ?? "");
  const [naoIncluso, setNaoIncluso] = useState(inicial.orcamentoNaoIncluso ?? "");
  const [normas, setNormas] = useState<string[]>(inicial.orcamentoNormas ?? []);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const mudou = <T,>(f: (v: T) => void) => (v: T) => { f(v); setMsg(null); };

  async function salvar() {
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
        }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? { tipo: "ok", texto: "Padrões salvos. Valem para os próximos orçamentos criados." } : { tipo: "erro", texto: j.erro ?? "Não foi possível salvar." });
    } catch {
      setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    } finally { setSalvando(false); }
  }

  return (
    <div className="bg-white rounded-card border border-surface-border p-6 space-y-8" data-padroes-orcamento>
      <fieldset disabled={!podeEditar} className="space-y-8 disabled:opacity-90">
        <FormSection title="Validade e garantias">
          <FormGrid cols={3}>
            <FormField label="Validade padrão (dias)" hint="O orçamento novo vale até hoje + estes dias. Editável em cada orçamento.">
              <Input type="number" inputMode="numeric" min={1} max={365} value={validade} onChange={(e) => mudou(setValidade)(e.target.value)} data-validade-dias />
            </FormField>
            <FormField label="Garantia dos serviços" hint="Sai nas Condições do documento">
              <Input value={garantiaServico} onChange={(e) => mudou(setGarantiaServico)(e.target.value)} list="padrao-garantia-servico" maxLength={200} placeholder="Ex.: 90 dias" data-garantia-servico />
            </FormField>
            <FormField label="Garantia das peças" hint="Sai nas Condições do documento">
              <Input value={garantiaPecas} onChange={(e) => mudou(setGarantiaPecas)(e.target.value)} list="padrao-garantia-pecas" maxLength={200} placeholder="Ex.: Conforme garantia do fabricante" data-garantia-pecas />
            </FormField>
          </FormGrid>
          <datalist id="padrao-garantia-servico">{GARANTIAS_SERVICO_SUGERIDAS.map((v) => <option key={v} value={v} />)}</datalist>
          <datalist id="padrao-garantia-pecas">{GARANTIAS_PECAS_SUGERIDAS.map((v) => <option key={v} value={v} />)}</datalist>
        </FormSection>

        <FormSection title="Não incluso">
          <p className="text-xs text-ink-muted -mt-2 mb-3" id="padrao-nao-incluso-dica">O que já vem listado como “Não incluso” no orçamento novo. Vazio = o bloco só aparece se alguém preencher no orçamento.</p>
          <NaoInclusoCampo id="padrao-nao-incluso" valor={naoIncluso} onChange={mudou(setNaoIncluso)} />
        </FormSection>

        <FormSection title="Normas atendidas">
          <p className="text-xs text-ink-muted -mt-2 mb-3">Marcadas aqui = já vêm ligadas no orçamento novo. Deixe todas desmarcadas para não poluir orçamentos simples (liga no orçamento que precisar).</p>
          <NormasCampo valor={normas} onChange={mudou(setNormas)} />
        </FormSection>
      </fieldset>

      {msg && (
        <div className={msg.tipo === "ok" ? "bg-ok-claro border border-ok/20 text-ok-texto text-sm rounded-lg px-4 py-3 flex items-center gap-2" : "bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3"} role="status">
          {msg.tipo === "ok" && <Check className="w-4 h-4" aria-hidden />} {msg.texto}
        </div>
      )}
      {podeEditar ? (
        <div className="flex justify-end pt-2 border-t border-surface-linha">
          <Button onClick={salvar} loading={salvando} data-salvar-padroes-orcamento>Salvar padrões do orçamento</Button>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Somente leitura: alterar exige “Configurações › Gerenciar”.</p>
      )}
    </div>
  );
}
