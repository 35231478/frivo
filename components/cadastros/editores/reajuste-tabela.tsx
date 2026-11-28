"use client";

import { useState } from "react";
import { ArrowRight, Check, Undo2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { toast } from "@/components/ui/avisos";
import { numeroDoCampo } from "@/lib/edicao-contexto";
import { formatarDataHora, formatarMoeda } from "@/lib/utils";
import { MOTIVO_MAX, MOTIVO_MIN } from "@/lib/precos/trava-tabela";
import { avisoDosIgnorados, erroDoPedido, textoDoReajuste, type LinhaReajuste, type PlanoDesfazer, type TipoReajuste } from "@/lib/precos/reajuste-tabela";

/**
 * Reajuste em massa da tabela de preço (lib/precos/reajuste-tabela): o modal de reajustar (tipo, valor, motivo →
 * prévia do servidor com o preço atual → novo → aplicar) e o de desfazer o último reajuste (o plano do servidor:
 * os itens que voltam e o aviso dos que ficam como estão).
 */
const itens = (n: number) => `${n} ${n === 1 ? "item" : "itens"}`;
/** O aviso depois de aplicar e de desfazer: o que aconteceu, com a contagem */
export const textoAplicado = (n: number) => `Reajuste aplicado: ${itens(n)} ${n === 1 ? "reajustado" : "reajustados"}.`;
export const textoDesfeito = (n: number) => n ? `Reajuste desfeito: ${itens(n)} ${n === 1 ? "voltou" : "voltaram"} ao preço anterior.` : "Reajuste desfeito. Nenhum item voltou ao preço anterior.";
/** "8,5", "-3", "1.250,00" (pt-BR, com vírgula) → número; o sinal de menos reduz. Inválido: NaN (o pedido recusa) */
const numeroDoValor = (v: string) => {
  const t = v.trim();
  const n = numeroDoCampo(t.startsWith("-") ? t.slice(1) : t);
  return n == null ? NaN : t.startsWith("-") ? -n : n;
};

const url = (tabelaId: string, resto = "") => `/api/cadastros/tabelas-preco/${tabelaId}/reajustes${resto}`;

async function postar(u: string, corpo: unknown): Promise<{ ok: boolean; d: any }> {
  try {
    const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    return { ok: r.ok, d: await r.json().catch(() => null) };
  } catch {
    return { ok: false, d: { erro: "Erro de conexão." } };
  }
}

function Erro({ texto }: { texto: string }) {
  return texto ? <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">{texto}</div> : null;
}

/** A lista item, preço atual → novo (a prévia do reajuste e a do desfazer) */
function ListaPrecos({ linhas }: { linhas: { descricao: string; de: number; para: number }[] }) {
  return (
    <ul className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-64 overflow-y-auto" data-previa-reajuste>
      {linhas.map((l, i) => (
        <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm" data-linha-previa>
          <span className="flex-1 min-w-0 truncate text-ink">{l.descricao}</span>
          <span className="font-mono text-ink-muted">{formatarMoeda(l.de)}</span>
          <ArrowRight className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
          <span className="font-mono font-semibold text-ink">{formatarMoeda(l.para)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ModalReajuste({ aberto, tabelaId, itemIds, onFechar, onAplicado }: {
  aberto: boolean; tabelaId: string;
  /** Os itens escolhidos (ids das linhas gravadas); vazio = todos */
  itemIds: string[];
  onFechar: () => void; onAplicado: () => void;
}) {
  const [tipo, setTipo] = useState<TipoReajuste>("PERCENTUAL");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [previa, setPrevia] = useState<LinhaReajuste[] | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const corpo = (comPrevia: boolean) => ({ tipo, valor: numeroDoValor(valor), motivo, previa: comPrevia, ...(itemIds.length ? { itemIds } : {}) });
  // Mexeu no pedido: a prévia mostrada deixa de valer
  const mudar = (f: () => void) => { f(); setPrevia(null); setErro(""); };

  async function verPrevia() {
    const e = erroDoPedido({ tipo, valor: valor.trim() === "" ? "" : numeroDoValor(valor) });
    if (e) { setErro(e); return; }
    setOcupado(true); setErro("");
    const r = await postar(url(tabelaId), corpo(true));
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro ?? "Não foi possível calcular a prévia."); return; }
    setPrevia(r.d.linhas);
  }
  async function aplicar() {
    if (motivo.trim().length < MOTIVO_MIN) { setErro(`Informe o motivo do reajuste (ao menos ${MOTIVO_MIN} caracteres).`); return; }
    setOcupado(true); setErro("");
    const r = await postar(url(tabelaId), corpo(false));
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro ?? "Não foi possível aplicar o reajuste."); return; }
    toast(textoAplicado(Array.isArray(r.d?.linhas) ? r.d.linhas.length : previa?.length ?? 0));
    setValor(""); setMotivo(""); setPrevia(null);
    onAplicado();
  }
  const fechar = () => { setPrevia(null); setErro(""); onFechar(); };

  return (
    <Modal aberto={aberto} onFechar={fechar} titulo="Reajustar preços" tamanho="lg">
      <div className="space-y-4" data-modal-reajuste>
        <p className="text-sm text-ink-muted" data-abrangencia>
          {itemIds.length ? `${itemIds.length} ${itemIds.length > 1 ? "itens selecionados" : "item selecionado"}.` : "Todos os itens da tabela."}
        </p>
        <Erro texto={erro} />
        <FormGrid cols={2}>
          <FormField label="Tipo de reajuste" dica="O reajuste vale sobre o preço atual de cada item. Item com desconto percentual passa a valor fixo com o preço novo; desfazer o reajuste devolve o desconto.">
            <Select value={tipo} onChange={(e) => mudar(() => setTipo(e.target.value as TipoReajuste))} data-tipo-reajuste>
              <option value="PERCENTUAL">Percentual (%)</option>
              <option value="VALOR">Valor (R$)</option>
            </Select>
          </FormField>
          <FormField label={tipo === "PERCENTUAL" ? "Percentual (%)" : "Valor (R$)"} required dica="Positivo aumenta, negativo reduz. Arredonda em centavos.">
            {/* Texto com vírgula (pt-BR), não type=number: "8,5" e o sinal de menos passam */}
            <Input inputMode="text" autoComplete="off" value={valor} onChange={(e) => { const v = e.target.value.replace(/[^\d.,-]/g, ""); mudar(() => setValor(v)); }} placeholder={tipo === "PERCENTUAL" ? "Ex.: 8,5" : "Ex.: 10,00"} data-valor-reajuste />
          </FormField>
        </FormGrid>
        <FormField label="Motivo" required>
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={MOTIVO_MAX} placeholder="Ex.: reajuste anual do contrato (IPCA)" data-motivo-reajuste />
        </FormField>

        {previa && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Prévia ({previa.length} {previa.length > 1 ? "itens" : "item"})</p>
            <ListaPrecos linhas={previa.map((l) => ({ descricao: l.descricao, de: l.antes.valorFinal, para: l.depois.valorFinal }))} />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={fechar}>Cancelar</Button>
          {previa
            ? <Button type="button" loading={ocupado} onClick={aplicar} data-aplicar-reajuste><Check className="w-4 h-4" /> Aplicar reajuste</Button>
            : <Button type="button" loading={ocupado} onClick={verPrevia} data-ver-previa>Ver prévia</Button>}
        </div>
      </div>
    </Modal>
  );
}

export interface LoteResumo { id: string; tipo: string; valor: number; motivo: string; criadoEm: string; usuarioNome?: string | null; itens?: number }

/** O botão "Desfazer reajuste" com a confirmação (o plano vem do servidor antes de desfazer) */
export function DesfazerReajuste({ tabelaId, lote, disabled, dica, onDesfeito }: { tabelaId: string; lote: LoteResumo; disabled?: boolean; dica?: string; onDesfeito: () => void }) {
  const [plano, setPlano] = useState<PlanoDesfazer | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(false);

  async function abrir() {
    setAberto(true); setPlano(null); setErro(""); setOcupado(true);
    const r = await postar(url(tabelaId, "/desfazer"), { previa: true });
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro ?? "Não foi possível ler o reajuste."); return; }
    setPlano(r.d.plano);
  }
  async function confirmar() {
    setOcupado(true); setErro("");
    const r = await postar(url(tabelaId, "/desfazer"), { previa: false });
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro ?? "Não foi possível desfazer o reajuste."); return; }
    setAberto(false);
    toast(textoDesfeito(Array.isArray(r.d?.plano?.voltam) ? r.d.plano.voltam.length : 0));
    onDesfeito();
  }
  const aviso = plano && avisoDosIgnorados(plano.ignorados);

  return (
    <>
      <Button type="button" size="sm" variant="secondary" disabled={disabled} title={dica} onClick={abrir} data-desfazer-reajuste>
        <Undo2 className="w-4 h-4" /> Desfazer reajuste
      </Button>
      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo="Desfazer reajuste" tamanho="lg">
        <div className="space-y-4" data-modal-desfazer>
          <p className="text-sm text-ink">
            Reajuste de <strong>{textoDoReajuste(lote.tipo, lote.valor)}</strong> em {formatarDataHora(lote.criadoEm)}{lote.usuarioNome ? `, por ${lote.usuarioNome}` : ""}.
            <span className="block text-ink-muted">Motivo: {lote.motivo}</span>
          </p>
          <Erro texto={erro} />
          {aviso && <p className="text-sm bg-atencao-claro border border-atencao/20 text-atencao-texto rounded-lg px-3 py-2" data-aviso-desfazer>{aviso}</p>}
          {plano && (plano.voltam.length
            ? <ListaPrecos linhas={plano.voltam.map((v) => ({ descricao: v.descricao, de: v.atual, para: v.preco.valorFinal }))} />
            : <p className="text-sm text-ink-muted">Nenhum item volta ao preço anterior.</p>)}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="button" variant="danger" loading={ocupado} disabled={!plano} onClick={confirmar} data-confirmar-desfazer>Desfazer reajuste</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
