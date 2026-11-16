"use client";

import { useState } from "react";
import { ChevronDown, Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { InputData } from "@/components/ui/input-data";
import { Dica } from "@/components/ui/dica";
import { cn, formatarData, formatarMoeda, LABELS_AJUSTE_FIM_SEMANA } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import {
  ATALHOS_REPETICAO, MAX_DIA, MIN_DIA, PASSO_MAX, PERSONALIZAR, atalhoDaRegra, previaDaRegra, textoRepeticao,
  type FormRecorrencia,
} from "@/lib/financeiro/conta-pagar-recorrencia";

const AJUDA_REPETICAO = "A repetição fica dentro da própria conta: ligando aqui, o sistema abre uma conta a pagar por mês (ou no intervalo escolhido), cada uma independente. Pagar, ajustar ou cancelar uma não mexe nas outras, e o ajuste de uma conta já aberta pergunta se vale só para ela ou daqui para a frente.";
const AJUDA_PREVIA = "São as contas que vão nascer com esta regra. Sem data para terminar, o sistema mantém sempre uns 12 meses abertos à frente e vai empurrando esse horizonte sozinho.";

/** Ordinais do "Cobrar sempre no": 1º dia do mês … 31º dia do mês */
const DIAS = Array.from({ length: MAX_DIA - MIN_DIA + 1 }, (_, i) => i + MIN_DIA);

/** dd/mm/aaaa ↔ as partes da competência (o "1º vencimento" manda no início da regra) */
const partesData = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return { ano: a, mes: m, dia: d };
};
const comoData = (ano: number, mes: number, dia: number) =>
  `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, 28)).padStart(2, "0")}`;

/**
 * A REPETIÇÃO de uma conta a pagar, dentro da própria conta — não há tela à parte.
 *
 * O desenho segue o que a casa já conhece de outros sistemas: um seletor de "Configurações de
 * repetição" com os atalhos de sempre e um "Personalizar…" que abre a frequência e o término; a
 * condição de pagamento troca o vencimento único por "Cobrar sempre no" + "1º vencimento"; e uma
 * prévia recolhível mostra, ANTES de salvar, exatamente as contas que vão nascer.
 */
export function CamposRecorrencia({ valor: f, onChange, anoBase, descricao, valorOcorrencia }: {
  valor: FormRecorrencia;
  onChange: (f: FormRecorrencia) => void;
  /** ano corrente (a prévia parte dele) */
  anoBase: number;
  /** descrição e valor da conta: a prévia mostra o que cada ocorrência vai levar */
  descricao: string;
  valorOcorrencia: number;
}) {
  const [personalizar, setPersonalizar] = useState(false);
  const [previaAberta, setPreviaAberta] = useState(false);
  const upd = <K extends keyof FormRecorrencia>(k: K, v: FormRecorrencia[K]) => onChange({ ...f, [k]: v });

  const regra = {
    passoMeses: Number(f.passoMeses) || 1,
    diaVencimento: Number(f.diaVencimento) || 1,
    ajusteDiaNaoUtil: f.ajusteDiaNaoUtil,
    inicioAno: Number(f.inicioAno), inicioMes: Number(f.inicioMes),
    fimAno: f.termino === "DATA" && f.fimAno ? Number(f.fimAno) : null,
    fimMes: f.termino === "DATA" && f.fimMes ? Number(f.fimMes) : null,
    ocorrencias: f.termino === "OCORRENCIAS" && f.ocorrencias ? Number(f.ocorrencias) : null,
  };
  const atalho = atalhoDaRegra(regra);
  const previa = previaDaRegra({ ...regra, descricao, valor: valorOcorrencia }, { ano: Number(f.inicioAno), mes: Number(f.inicioMes) });
  const primeiroVencimento = comoData(Number(f.inicioAno), Number(f.inicioMes), Number(f.diaVencimento) || 1);

  /** O atalho escolhido reescreve passo e término de uma vez (é a regra inteira). */
  function escolherAtalho(id: string) {
    if (id === PERSONALIZAR) { setPersonalizar(true); return; }
    const a = ATALHOS_REPETICAO.find((x) => x.id === id);
    if (!a) return;
    onChange({
      ...f, passoMeses: String(a.passoMeses),
      termino: a.ocorrencias ? "OCORRENCIAS" : "INDEFINIDO",
      ocorrencias: a.ocorrencias ? String(a.ocorrencias) : "",
      fimAno: "", fimMes: "",
    });
  }

  /** O "1º vencimento" manda no início da regra — e o dia dele vira o "Cobrar sempre no". */
  function escolherPrimeiroVencimento(iso: string) {
    if (!iso) return;
    const { ano, mes, dia } = partesData(iso);
    onChange({ ...f, inicioAno: String(ano), inicioMes: String(mes), diaVencimento: String(dia) });
  }

  return (
    <div className="space-y-5" data-campos-recorrencia>
      <FormGrid>
        <FormField label="Configurações de repetição" required>
          <Select value={atalho} onChange={(e) => escolherAtalho(e.target.value)} data-config-repeticao aria-label="Configurações de repetição">
            {ATALHOS_REPETICAO.map((a) => <option key={a.id} value={a.id}>{a.rotulo}</option>)}
            {atalho === PERSONALIZAR && <option value={PERSONALIZAR}>{textoRepeticao(regra)}</option>}
            <option value={PERSONALIZAR} data-personalizar>Personalizar…</option>
          </Select>
        </FormField>
      </FormGrid>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-ink border-b border-surface-border pb-2">Condição de pagamento</p>
        <FormGrid cols={3}>
          <FormField label="Cobrar sempre no" required>
            <Select value={f.diaVencimento} onChange={(e) => upd("diaVencimento", e.target.value)} data-dia-vencimento aria-label="Cobrar sempre no">
              {DIAS.map((d) => <option key={d} value={d}>{d}º dia do mês</option>)}
            </Select>
          </FormField>
          <FormField label="1º vencimento" required>
            <InputData value={primeiroVencimento} onChange={escolherPrimeiroVencimento} aria-label="1º vencimento" />
          </FormField>
          <FormField label="Quando cair em fim de semana">
            <Select value={f.ajusteDiaNaoUtil} onChange={(e) => upd("ajusteDiaNaoUtil", e.target.value)} data-ajuste-dia aria-label="Quando cair em fim de semana">
              {Object.entries(LABELS_AJUSTE_FIM_SEMANA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormField>
        </FormGrid>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink cursor-pointer" data-valor-estimado>
        <input type="checkbox" className="mt-0.5" checked={f.valorEstimado} onChange={(e) => upd("valorEstimado", e.target.checked)} />
        <span className="min-w-0">
          Valor a confirmar (estimado)
          <span className="block text-xs text-ink-muted">Para energia, água e cartão: a conta nasce com o valor previsto e o ajuste vem com o boleto.</span>
        </span>
      </label>

      {/* A prévia: o que vai nascer, antes de salvar */}
      <div className="rounded-lg border border-surface-border" data-previa-recorrencias>
        <button type="button" onClick={() => setPreviaAberta((v) => !v)} data-abrir-previa
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-alt/50 rounded-lg">
          <span className="flex items-center gap-1.5">
            <Repeat className="w-4 h-4 text-primary-600" /> Recorrências previstas
            <span className="font-normal text-ink-muted">({previa.length})</span>
            <Dica texto={AJUDA_PREVIA} rotulo="Recorrências previstas" />
          </span>
          <ChevronDown className={cn("w-4 h-4 text-ink-subtle transition-transform", previaAberta && "rotate-180")} />
        </button>
        {previaAberta && (
          <div className="border-t border-surface-border max-h-64 overflow-y-auto">
            {previa.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-subtle" data-previa-vazia>Nenhuma ocorrência com esta regra.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-alt/80 backdrop-blur">
                  <tr className={PLANILHA.cabecalho}>
                    <th className={cn(PLANILHA.th, "text-left")}>Vencimento</th>
                    <th className={cn(PLANILHA.th, "text-left")}>Lançamento</th>
                    <th className={cn(PLANILHA.th, "text-right")}>Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.map((o) => (
                    <tr key={`${o.ano}-${o.mes}`} className="border-t border-surface-border" data-previa-linha={`${o.ano}-${o.mes}`}>
                      <td className={cn("px-4 py-1.5", PLANILHA.data)}>{formatarData(o.vencimento)}</td>
                      <td className="px-4 py-1.5 text-ink truncate">{o.descricao}</td>
                      <td className={cn("px-4 py-1.5 text-right", PLANILHA.numero)}>{formatarMoeda(o.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <Modal aberto={personalizar} onFechar={() => setPersonalizar(false)} titulo="Recorrência">
        <PersonalizarRecorrencia valor={f} anoBase={anoBase} onConfirmar={(novo) => { onChange(novo); setPersonalizar(false); }} onCancelar={() => setPersonalizar(false)} />
      </Modal>
    </div>
  );
}

/** A ajuda do toggle, para a tela que liga a repetição não repetir o texto */
export const AJUDA_REPETIR = AJUDA_REPETICAO;

/** "Personalizar…": a frequência e o término, do jeito que a pessoa quiser. */
function PersonalizarRecorrencia({ valor, anoBase, onConfirmar, onCancelar }: {
  valor: FormRecorrencia; anoBase: number;
  onConfirmar: (f: FormRecorrencia) => void; onCancelar: () => void;
}) {
  const [f, setF] = useState(valor);
  const [erro, setErro] = useState("");
  const upd = <K extends keyof FormRecorrencia>(k: K, v: FormRecorrencia[K]) => setF((s) => ({ ...s, [k]: v }));
  const anos = Array.from({ length: 6 }, (_, i) => anoBase + i);

  function confirmar() {
    const passo = Number(f.passoMeses);
    if (!Number.isInteger(passo) || passo < 1 || passo > PASSO_MAX) { setErro(`Repetir a cada: de 1 a ${PASSO_MAX} meses.`); return; }
    if (f.termino === "OCORRENCIAS" && (!Number.isInteger(Number(f.ocorrencias)) || Number(f.ocorrencias) < 1)) {
      setErro("Informe quantas ocorrências."); return;
    }
    if (f.termino === "DATA" && (!f.fimAno || !f.fimMes)) { setErro("Escolha o mês e o ano do término."); return; }
    onConfirmar(f);
  }

  return (
    <div className="space-y-5" data-personalizar-recorrencia>
      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-personalizar>{erro}</div>}

      <div className="space-y-3">
        <p className="text-sm font-semibold text-ink border-b border-surface-border pb-2">Frequência da recorrência</p>
        <FormGrid>
          <FormField label="Repetir a cada" required hint={`De 1 a ${PASSO_MAX} meses`}>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={PASSO_MAX} className={cn(PLANILHA.numero, "w-24")} value={f.passoMeses}
                onChange={(e) => upd("passoMeses", e.target.value)} data-passo-meses aria-label="Repetir a cada" />
              <span className="text-sm text-ink-muted">{Number(f.passoMeses) === 1 ? "mês" : "meses"}</span>
            </div>
          </FormField>
        </FormGrid>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-ink border-b border-surface-border pb-2">Término da recorrência</p>
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer" data-termino="OCORRENCIAS">
          <input type="radio" name="termino-recorrencia" checked={f.termino === "OCORRENCIAS"} onChange={() => upd("termino", "OCORRENCIAS")} />
          Após
          <Input type="number" min={1} className={cn(PLANILHA.numero, "w-24")} value={f.ocorrencias}
            onChange={(e) => setF((s) => ({ ...s, ocorrencias: e.target.value, termino: "OCORRENCIAS" }))} data-ocorrencias aria-label="Quantas ocorrências" />
          ocorrências
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink cursor-pointer" data-termino="DATA">
          <input type="radio" name="termino-recorrencia" checked={f.termino === "DATA"} onChange={() => upd("termino", "DATA")} />
          Até
          <Select value={f.fimMes} onChange={(e) => setF((s) => ({ ...s, fimMes: e.target.value, termino: "DATA" }))} className="w-36" data-fim-mes aria-label="Mês do término">
            <option value="">Mês</option>
            {["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
              .map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
          <Select value={f.fimAno} onChange={(e) => setF((s) => ({ ...s, fimAno: e.target.value, termino: "DATA" }))} className="w-28" data-fim-ano aria-label="Ano do término">
            <option value="">Ano</option>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer" data-termino="INDEFINIDO">
          <input type="radio" name="termino-recorrencia" checked={f.termino === "INDEFINIDO"} onChange={() => upd("termino", "INDEFINIDO")} />
          Sem data para terminar
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
        <Button onClick={confirmar} data-confirmar-personalizar>Confirmar</Button>
      </div>
    </div>
  );
}
