"use client";

import { AlertTriangle, Barcode, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, formatarMoeda } from "@/lib/utils";
import { avisoValorBoleto, formatarLinhaDigitavel, lerBoleto } from "@/lib/financeiro/boleto";

const diaBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Campo para colar a linha digitável ou o código de barras do boleto ("DDA manual"). Confere os
 * dígitos verificadores enquanto a pessoa cola e mostra o que o código diz (banco/convênio, valor e
 * vencimento). Valor ou vencimento diferente da parcela: só avisa.
 */
export function CampoBoleto({ valor, onChange, valorParcela, vencimentoParcela, rotulo = "Boleto (linha digitável ou código de barras)", name, compacto = false }: {
  valor: string;
  onChange: (v: string) => void;
  valorParcela?: number | null;
  /** "AAAA-MM-DD": decide o fator de vencimento ambíguo e o aviso de data diferente */
  vencimentoParcela?: string | null;
  rotulo?: string;
  name?: string;
  compacto?: boolean;
}) {
  const digitos = valor.replace(/\D/g, "");
  const leitura = digitos ? lerBoleto(valor, vencimentoParcela ? new Date(`${vencimentoParcela}T12:00:00Z`) : new Date()) : null;
  const b = leitura?.ok ? leitura.boleto : null;
  const avisos = b ? [
    valorParcela != null ? avisoValorBoleto(b, valorParcela) : null,
    b.vencimento && vencimentoParcela && b.vencimento !== vencimentoParcela ? `O boleto vence em ${diaBr(b.vencimento)} e a parcela, em ${diaBr(vencimentoParcela)}.` : null,
  ].filter((x): x is string => !!x) : [];

  return (
    <div className="space-y-1" data-campo-boleto={name}>
      {!compacto && <span className="text-xs font-semibold text-ink">{rotulo}</span>}
      <div className="relative">
        <Barcode className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
        <Input value={valor} onChange={(e) => onChange(e.target.value)} inputMode="numeric" autoComplete="off" spellCheck={false}
          placeholder="Cole a linha digitável do boleto" aria-label={rotulo} name={name}
          className={cn("pl-9 font-mono text-xs", leitura && !leitura.ok && "border-atrasado", b && "border-success-400")} />
      </div>
      {leitura && !leitura.ok && <p className="text-xs text-atrasado" role="alert" data-boleto-erro>{leitura.erro}</p>}
      {b && (
        <p className="text-xs text-success-700 flex flex-wrap items-center gap-x-1.5" data-boleto-ok>
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{b.tipo === "bancario" ? `${b.emissor} (${b.banco})` : b.emissor}</span>
          {b.valor != null && <span>· {formatarMoeda(b.valor)}</span>}
          {b.vencimento && <span>· vence {diaBr(b.vencimento)}</span>}
          {/* colou o código de barras (ou só dígitos): mostra a linha digitável que ele vira */}
          {formatarLinhaDigitavel(b.linhaDigitavel) !== valor.trim() && <span className="text-ink-subtle font-mono break-all">· {formatarLinhaDigitavel(b.linhaDigitavel)}</span>}
        </p>
      )}
      {avisos.map((a) => <p key={a} className="text-xs text-atencao-texto flex items-start gap-1" data-boleto-aviso><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />{a}</p>)}
    </div>
  );
}
