"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { toast } from "@/components/ui/avisos";
import { PLANILHA } from "@/lib/planilha";
import { LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { CamposRecorrencia } from "@/components/financeiro/campos-recorrencia";
import {
  corpoDaRecorrencia, formDaRegra, formRecorrenciaInicial, validarRegra, type FormRecorrencia,
} from "@/lib/financeiro/conta-pagar-recorrencia";
import { chaveHojeBR } from "@/lib/fuso";

/** A regra como a tela de Despesas recorrentes a carrega (o mesmo formato da lista) */
interface Regra {
  id: string; descricao: string; valor: number; valorEstimado: boolean;
  passoMeses: number; diaVencimento: number; ajusteDiaNaoUtil: string;
  inicioAno: number; inicioMes: number; fimAno: number | null; fimMes: number | null; ocorrencias: number | null;
  situacao: string;
  categoriaId: string | null; centroCusto: { id: string } | null; formaPagamento: string | null; observacao: string | null;
}
/** A conta avulsa que vai virar a primeira ocorrência */
interface Conta { id: string; numero: string; descricao: string; valorTotal: number; dataVencimento: string | null }

const hojeBR = () => { const [ano, mes, dia] = chaveHojeBR().split("-").map(Number); return { ano, mes, dia }; };

/**
 * Editar a REGRA de uma despesa recorrente, ou transformar uma conta avulsa na primeira ocorrência
 * de uma. Os dois usam os mesmos campos (components/financeiro/campos-recorrencia) e a mesma
 * validação do servidor (validarRegra), para a tela nunca pedir o que a rota recusa.
 *
 * Editar a regra vale para as ocorrências FUTURAS ainda em aberto: as pagas e as passadas ficam
 * como estão. É o servidor que garante isso.
 */
export function RegraRecorrenteForm({ regra, conta, onPronto, onCancelar }: {
  regra?: Regra;
  conta?: Conta;
  onPronto: () => void;
  onCancelar: () => void;
}) {
  const base = conta?.dataVencimento ? new Date(conta.dataVencimento) : null;
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [descricao, setDescricao] = useState(regra?.descricao ?? conta?.descricao ?? "");
  const [valor, setValor] = useState(String(regra?.valor ?? conta?.valorTotal ?? ""));
  const [categoriaId, setCategoriaId] = useState(regra?.categoriaId ?? "");
  const [centroCustoId, setCentroCustoId] = useState(regra?.centroCusto?.id ?? "");
  const [formaPagamento, setFormaPagamento] = useState(regra?.formaPagamento ?? "");
  const [observacao, setObservacao] = useState(regra?.observacao ?? "");
  const [rec, setRec] = useState<FormRecorrencia>(() =>
    regra ? formDaRegra(regra) : formRecorrenciaInicial(hojeBR(), base ? base.getDate() : null));

  async function salvar() {
    setErro("");
    const corpo = { ...corpoDaRecorrencia(rec), descricao: descricao.trim(), valor: Number(valor) };
    const problema = validarRegra(corpo);
    if (problema) { setErro(problema); return; }
    setSalvando(true);
    try {
      const url = regra ? `/api/contas-pagar/recorrencias/${regra.id}` : `/api/contas-pagar/${conta!.id}/tornar-recorrente`;
      const res = await fetch(url, {
        method: regra ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...corpo,
          categoriaId: categoriaId || null,
          centroCustoId: centroCustoId || null,
          formaPagamento: formaPagamento || null,
          observacao: observacao || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErro(d.erro ?? "Não foi possível salvar."); return; }
      const d = await res.json().catch(() => ({}));
      if (regra) {
        const partes = [
          Number(d.atualizadas ?? 0) > 0 ? `${d.atualizadas} ${Number(d.atualizadas) === 1 ? "ocorrência em aberto acompanhou" : "ocorrências em aberto acompanharam"}` : "",
          Number(d.geradas ?? 0) > 0 ? `${d.geradas} ${Number(d.geradas) === 1 ? "nova conta" : "novas contas"}` : "",
          Number(d.canceladas ?? 0) > 0 ? `${d.canceladas} fora do período ${Number(d.canceladas) === 1 ? "cancelada" : "canceladas"}` : "",
        ].filter(Boolean);
        toast(partes.length ? `Regra salva: ${partes.join(", ")}.` : "Regra salva.");
      } else {
        toast(`Conta ${conta!.numero} agora é a primeira ocorrência de uma despesa recorrente.`);
      }
      onPronto();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4" data-form-regra>
      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-regra>{erro}</div>}

      {!regra && (
        <p className="text-sm text-ink-muted" data-aviso-tornar>
          A conta <strong className="text-ink">{conta!.numero}</strong> continua como está — mesmo número, mesmos pagamentos, mesmo histórico —
          e passa a ser a primeira ocorrência. As próximas nascem a partir dela.
        </p>
      )}

      <FormGrid>
        <FormField label="Descrição" required>
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Aluguel do galpão" data-descricao-regra />
        </FormField>
        <FormField label="Valor de cada ocorrência" required hint="Não multiplica: é o valor de cada mês">
          <Input type="number" step="0.01" className={PLANILHA.numero} value={valor} onChange={(e) => setValor(e.target.value)} data-valor-regra />
        </FormField>
      </FormGrid>

      <CamposRecorrencia valor={rec} onChange={setRec} anoBase={hojeBR().ano} />

      <FormGrid>
        <FormField label="Categoria">
          <SeletorCadastro entidade="categorias-financeiras" valor={categoriaId} vazio="Sem categoria" onChange={setCategoriaId} />
        </FormField>
        <FormField label="Centro de custo">
          <SeletorCadastro entidade="centros-custo" valor={centroCustoId} vazio="Sem centro de custo" onChange={setCentroCustoId} />
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Forma de pagamento">
          <Select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} data-forma-regra>
            <option value="">Selecione…</option>
            {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
      </FormGrid>
      <FormField label="Observação">
        <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
      </FormField>

      <p className="text-xs text-ink-subtle">
        O que você mudar vale para as ocorrências futuras ainda em aberto. As já pagas não mudam.
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
        <Button loading={salvando} onClick={salvar}>{regra ? "Salvar a regra" : "Tornar recorrente"}</Button>
      </div>
    </div>
  );
}
