"use client";

import { useState } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/avisos";
import { CamposRecorrencia } from "@/components/financeiro/campos-recorrencia";
import { chaveHojeBR } from "@/lib/fuso";
import {
  ESCOPOS, ROTULO_ESCOPO, corpoDaRecorrencia, formRecorrenciaInicial, validarRegra,
  type EscopoEdicao, type FormRecorrencia,
} from "@/lib/financeiro/conta-pagar-recorrencia";

const hojeBR = () => { const [ano, mes, dia] = chaveHojeBR().split("-").map(Number); return { ano, mes, dia }; };

interface Conta { id: string; numero: string; descricao: string; valorTotal: number; dataVencimento: string | null }

/**
 * TORNAR REPETIDA uma conta que já existe — dentro da própria conta, sem tela à parte.
 * A conta NÃO é recriada: mantém número, pagamentos e histórico, e passa a ser a primeira
 * ocorrência; as próximas nascem a partir dela.
 */
export function TornarRecorrente({ conta, onPronto, onCancelar }: {
  conta: Conta; onPronto: () => void; onCancelar: () => void;
}) {
  const base = conta.dataVencimento ? new Date(conta.dataVencimento) : null;
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [rec, setRec] = useState<FormRecorrencia>(() => {
    const inicial = formRecorrenciaInicial(hojeBR(), base ? base.getDate() : null);
    return base ? { ...inicial, inicioAno: String(base.getFullYear()), inicioMes: String(base.getMonth() + 1) } : inicial;
  });

  async function salvar() {
    setErro("");
    const corpo = { ...corpoDaRecorrencia(rec), descricao: conta.descricao, valor: conta.valorTotal };
    const problema = validarRegra(corpo);
    if (problema) { setErro(problema); return; }
    setSalvando(true);
    try {
      const res = await fetch(`/api/contas-pagar/${conta.id}/tornar-recorrente`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErro(d.erro ?? "Não foi possível repetir o lançamento."); return; }
      toast(`Conta ${conta.numero} agora se repete. As próximas já estão abertas.`);
      onPronto();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4" data-tornar-recorrente-form>
      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-recorrencia>{erro}</div>}
      <div className="text-sm text-ink-muted space-y-1" data-aviso-tornar>
        <p>A conta <strong className="text-ink">{conta.numero}</strong> continua como está: mesmo número, mesmos pagamentos, mesmo histórico.</p>
        <p>Ela passa a ser a primeira ocorrência; as próximas nascem a partir dela.</p>
      </div>

      <CamposRecorrencia valor={rec} onChange={setRec} anoBase={hojeBR().ano}
        descricao={conta.descricao} valorOcorrencia={conta.valorTotal} />

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
        <Button loading={salvando} onClick={salvar} data-confirmar-recorrencia><Repeat className="w-4 h-4" /> Repetir lançamento</Button>
      </div>
    </div>
  );
}

/**
 * CANCELAR uma conta que se repete: a pergunta não é "tem certeza", é ATÉ ONDE.
 *  - "Só esta ocorrência": cancela o mês e a repetição continua (o mês seguinte nasce normalmente);
 *  - "Esta e as próximas em aberto": encerra a repetição — as futuras em aberto saem do caminho.
 * Em nenhum dos dois alguma conta é apagada, e conta paga não muda.
 */
export function CancelarComAlcance({ conta, onPronto, onCancelar }: {
  conta: { id: string; numero: string; recorrenciaId: string };
  onPronto: () => void; onCancelar: () => void;
}) {
  const [escopo, setEscopo] = useState<EscopoEdicao>("ESTA");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const ajuda: Record<EscopoEdicao, string> = {
    ESTA: "Esta conta fica no histórico como cancelada. A repetição continua: o mês seguinte nasce normalmente.",
    ESTA_E_PROXIMAS: "Encerra a repetição. Esta conta e as próximas ainda em aberto ficam canceladas; as já pagas não mudam.",
  };

  async function confirmar() {
    setErro(""); setSalvando(true);
    try {
      // "esta e as próximas" encerra a regra (o servidor cancela as futuras em aberto)…
      if (escopo === "ESTA_E_PROXIMAS") {
        const r = await fetch(`/api/contas-pagar/recorrencias/${conta.recorrenciaId}/acao`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "ENCERRAR", motivo: `Encerrada ao cancelar a conta ${conta.numero}.` }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); setErro(d.erro ?? "Não foi possível encerrar a repetição."); return; }
      }
      // …e em qualquer um dos dois esta conta sai do caminho (cancelada, nunca apagada)
      const res = await fetch(`/api/contas-pagar/${conta.id}/pular`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // a regra já foi encerrada: o caso comum aqui é a conta já estar paga
        setErro(d.erro ?? "Não foi possível cancelar a conta."); return;
      }
      toast(escopo === "ESTA_E_PROXIMAS"
        ? `Conta ${conta.numero} cancelada e repetição encerrada.`
        : `Conta ${conta.numero} cancelada. A repetição continua.`);
      onPronto();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4" data-cancelar-alcance>
      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-cancelar>{erro}</div>}
      <p className="text-sm text-ink">Esta conta se repete. Até onde vai o cancelamento?</p>
      <div className="space-y-2">
        {ESCOPOS.map((e) => (
          <label key={e} className="flex items-start gap-2 text-sm cursor-pointer" data-escopo-cancelar={e}>
            <input type="radio" name="escopo-cancelar" className="mt-1" checked={escopo === e} onChange={() => setEscopo(e)} />
            <span className="min-w-0">
              <span className="font-medium text-ink">{ROTULO_ESCOPO[e]}</span>
              <span className="block text-xs text-ink-muted">{ajuda[e]}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-subtle">Nada é apagado: a conta fica no histórico como cancelada, e o que já foi pago continua registrado.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar}>Voltar</Button>
        <Button loading={salvando} onClick={confirmar} variant="danger" data-confirmar-cancelar>Cancelar conta</Button>
      </div>
    </div>
  );
}
