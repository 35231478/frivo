"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { SomenteLeitura } from "@/components/config/permissao-config";
import { cn } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import { formatarNumero, minimoPermitido, NUMERO_MAXIMO, type NumeracaoTela, type TipoNumeracao } from "@/lib/numeracao";

const COLUNAS: ColunaPro[] = [
  { id: "documento", titulo: "Documento", obrigatoria: true, minimo: 200 },
  { id: "maior", titulo: "Maior já usado", largura: 130, alinhar: "direita" },
  { id: "proximo", titulo: "Próximo número", largura: 170, obrigatoria: true },
  { id: "exemplo", titulo: "Vai sair como", largura: 150 },
  { id: "acoes", titulo: "Salvar", semTitulo: true, fixa: true, largura: 96, alinhar: "direita" },
];

/**
 * Numeração de documentos, no padrão de lista: uma linha por tipo com o maior número já usado e o campo
 * "Próximo número" (cartões no celular). A tela não deixa salvar um próximo igual ou abaixo do maior
 * usado (o servidor recusa também e diz o mínimo). Cada linha salva sozinha e avisa (toast); o erro
 * fica na própria linha. Sem Configurações › Gerenciar: só leitura, sem o botão Salvar.
 */
export function NumeracaoClient({ inicial, podeEditar }: { inicial: NumeracaoTela[]; podeEditar: boolean }) {
  const [linhas, setLinhas] = useState(inicial);
  const [valores, setValores] = useState<Record<string, string>>(Object.fromEntries(inicial.map((n) => [n.tipo, String(n.proximo)])));
  const [salvando, setSalvando] = useState<TipoNumeracao | null>(null);
  const [msgs, setMsgs] = useState<Record<string, { texto: string } | undefined>>({});

  const mudar = (tipo: TipoNumeracao, v: string) => { setValores((s) => ({ ...s, [tipo]: v })); setMsgs((m) => ({ ...m, [tipo]: undefined })); };

  /** O que impede salvar esta linha agora (vazio = pode) */
  const problema = (n: NumeracaoTela): string | null => {
    const v = valores[n.tipo];
    if (!/^\d+$/.test(v ?? "")) return "Informe um número inteiro.";
    const num = Number(v);
    if (num < minimoPermitido(n.maiorUsado)) return `O mínimo permitido é ${minimoPermitido(n.maiorUsado)}${n.maiorUsado > 0 ? ` (o maior já usado é ${n.maiorUsado})` : ""}.`;
    if (num > NUMERO_MAXIMO) return `O máximo é ${NUMERO_MAXIMO.toLocaleString("pt-BR")}.`;
    return null;
  };

  async function salvar(n: NumeracaoTela) {
    const erro = problema(n);
    if (erro) { setMsgs((m) => ({ ...m, [n.tipo]: { texto: erro } })); return; }
    const proximo = Number(valores[n.tipo]);
    setSalvando(n.tipo);
    try {
      const r = await fetch("/api/configuracoes/numeracao", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: n.tipo, proximo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsgs((m) => ({ ...m, [n.tipo]: { texto: j.erro ?? "Não foi possível salvar." } }));
        // O servidor sabe o mínimo de verdade (outro documento pode ter nascido enquanto isso)
        if (typeof j.minimo === "number") setLinhas((ls) => ls.map((l) => (l.tipo === n.tipo ? { ...l, maiorUsado: j.minimo - 1 } : l)));
        return;
      }
      setLinhas((ls) => ls.map((l) => (l.tipo === n.tipo ? { ...l, proximo: j.proximo, exemplo: j.exemplo, configurado: true } : l)));
      setMsgs((m) => ({ ...m, [n.tipo]: undefined }));
      toast(`Numeração salva: o próximo ${n.rotulo.toLowerCase()} sai como ${j.exemplo}.`);
    } catch {
      setMsgs((m) => ({ ...m, [n.tipo]: { texto: "Sem conexão. Tente de novo." } }));
    } finally { setSalvando(null); }
  }

  /** O campo "Próximo número" de uma linha (o mesmo na tabela e no cartão do celular) */
  const campoProximo = (n: NumeracaoTela) => {
    const v = valores[n.tipo] ?? "";
    const invalido = v !== String(n.proximo) && !!problema(n);
    return (
      <input
        type="number" inputMode="numeric" min={minimoPermitido(n.maiorUsado)} max={NUMERO_MAXIMO} step={1}
        value={v} onChange={(e) => mudar(n.tipo, e.target.value)} disabled={!podeEditar}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void salvar(n); } }}
        aria-label={`Próximo número de ${n.rotulo.toLowerCase()}`} aria-invalid={invalido} data-proximo={n.tipo}
        className={cn("w-full bg-white border rounded-lg px-3 py-1.5 text-sm text-ink tabular-nums focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:bg-surface-alt",
          invalido ? "border-atrasado" : "border-surface-border")}
      />
    );
  };
  const exemploDe = (n: NumeracaoTela) => { const v = valores[n.tipo] ?? ""; return /^\d+$/.test(v) ? formatarNumero(n.tipo, Number(v)) : "—"; };
  /** O erro da linha: o que o servidor disse ou, enquanto digita, o que impede salvar */
  const aviso = (n: NumeracaoTela) => {
    const msg = msgs[n.tipo];
    const erro = problema(n);
    if (msg) return <p className="text-xs mt-1 text-atrasado" data-msg="erro" role="alert">{msg.texto}</p>;
    if ((valores[n.tipo] ?? "") !== String(n.proximo) && erro) return <p className="text-xs mt-1 text-atrasado" data-msg="aviso">{erro}</p>;
    return null;
  };
  const botaoSalvar = (n: NumeracaoTela) => podeEditar && (
    <button
      type="button" onClick={() => void salvar(n)} disabled={(valores[n.tipo] ?? "") === String(n.proximo) || !!problema(n) || salvando === n.tipo} data-salvar={n.tipo}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40"
    >
      {salvando === n.tipo ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Check className="w-3.5 h-3.5" aria-hidden />} Salvar
    </button>
  );
  const nomeDe = (n: NumeracaoTela) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={PLANILHA.nome}>{n.rotulo}</span>
      <span className={cn(PLANILHA.codigo, "text-ink-subtle font-normal")}>{n.prefixo}-</span>
      <Dica texto={n.dica} rotulo={n.rotulo} />
    </span>
  );
  const maiorDe = (n: NumeracaoTela) => (n.maiorUsado > 0 ? n.maiorUsado.toLocaleString("pt-BR") : "—");

  return (
    <div className="space-y-3" data-numeracao>
      {/* Celular: um cartão por documento */}
      <ul className="sm:hidden space-y-2" data-cartoes>
        {linhas.map((n) => (
          <li key={n.tipo} data-cartao={n.tipo} className="border border-surface-border rounded-lg bg-white p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              {nomeDe(n)}
              <span className="text-xs text-ink-muted shrink-0">Maior já usado: <span className="tabular-nums text-ink">{maiorDe(n)}</span></span>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex-1 min-w-0 text-xs text-ink-muted">Próximo número{campoProximo(n)}</label>
              {botaoSalvar(n)}
            </div>
            <p className="text-xs text-ink-muted">Sai como <span className={PLANILHA.codigo}>{exemploDe(n)}</span></p>
            {aviso(n)}
          </li>
        ))}
      </ul>
      <TabelaPro
        tela="config-numeracao" quebra="sm" className="hidden sm:block border border-surface-border rounded-lg overflow-hidden" colunas={COLUNAS}
        barra={<span data-total-numeracao>{linhas.length} documentos</span>}
        linhas={linhas.map((n) => ({
          id: n.tipo, atributos: { "data-numeracao-tipo": n.tipo },
          celulas: {
            documento: <>{nomeDe(n)}{aviso(n)}</>,
            maior: <span className="text-ink-muted" data-maior-usado>{maiorDe(n)}</span>,
            proximo: campoProximo(n),
            exemplo: <span className={PLANILHA.codigo} data-exemplo>{exemploDe(n)}</span>,
            acoes: botaoSalvar(n),
          },
        }))}
      />
      {!podeEditar && <SomenteLeitura />}
    </div>
  );
}
