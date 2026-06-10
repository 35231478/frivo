/**
 * Templates de e-mail transacional e layout HTML profissional (compatível com
 * Gmail/Outlook). Puro — sem dependências de Node.
 */

export interface DefTemplate {
  tipo: string;
  nome: string;
  assunto: string;
  corpo: string;       // HTML com variáveis {{x}}
  botaoLabel?: string;
  botaoVar?: string;   // nome da variável que contém o link do botão
}

/** Variáveis que podem ser usadas em assunto/corpo. */
export const VARIAVEIS_DISPONIVEIS = [
  "cliente_nome", "cliente_cnpj", "valor", "vencimento", "dias_para_vencer", "dias_em_atraso",
  "descricao", "numero_os", "numero_orcamento", "numero_contrato",
  "link_boleto", "link_documento", "link_orcamento",
  "empresa_nome", "empresa_telefone", "empresa_email", "empresa_site",
  "mes_referencia", "data_aprovacao",
] as const;

export const TEMPLATES_PADRAO: DefTemplate[] = [
  { tipo: "BOLETO_EMITIDO", nome: "Boleto Emitido", assunto: "Boleto referente a {{descricao}} — Vencimento {{vencimento}}",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Seu boleto referente a <strong>{{descricao}}</strong> no valor de <strong>{{valor}}</strong> foi gerado e vence em <strong>{{vencimento}}</strong>.</p><p>Você pode baixá-lo pelo botão abaixo.</p>",
    botaoLabel: "Baixar boleto", botaoVar: "link_boleto" },
  { tipo: "LEMBRETE_VENCIMENTO", nome: "Lembrete de Vencimento", assunto: "Lembrete: cobrança vence em {{dias_para_vencer}} dias",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Lembramos que a cobrança referente a <strong>{{descricao}}</strong> no valor de <strong>{{valor}}</strong> vence em <strong>{{dias_para_vencer}}</strong> dia(s), em {{vencimento}}.</p>",
    botaoLabel: "Ver cobrança", botaoVar: "link_boleto" },
  { tipo: "CONFIRMACAO_PAGAMENTO", nome: "Confirmação de Pagamento", assunto: "Pagamento confirmado — Obrigado, {{cliente_nome}}!",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Confirmamos o recebimento do pagamento de <strong>{{valor}}</strong> referente a <strong>{{descricao}}</strong>. Obrigado pela confiança!</p>" },
  { tipo: "COBRANCA_ATRASO", nome: "Cobrança em Atraso", assunto: "Aviso: cobrança em atraso — {{empresa_nome}}",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Identificamos que a cobrança referente a <strong>{{descricao}}</strong> (<strong>{{valor}}</strong>) está em atraso há <strong>{{dias_em_atraso}}</strong> dia(s). Por favor, regularize para evitar encargos.</p>",
    botaoLabel: "Regularizar", botaoVar: "link_boleto" },
  { tipo: "MEDICAO_DISPONIVEL", nome: "Medição/Relatório Disponível", assunto: "Relatório de manutenção {{mes_referencia}} — {{empresa_nome}}",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>O relatório de manutenção referente a <strong>{{mes_referencia}}</strong> já está disponível para consulta e aprovação.</p>",
    botaoLabel: "Ver relatório", botaoVar: "link_documento" },
  { tipo: "ORCAMENTO_ENVIADO", nome: "Orçamento Enviado", assunto: "Orçamento {{numero_orcamento}} — {{empresa_nome}}",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Segue o orçamento <strong>{{numero_orcamento}}</strong> no valor de <strong>{{valor}}</strong>. Você pode visualizá-lo e aprová-lo digitalmente pelo botão abaixo.</p>",
    botaoLabel: "Ver orçamento", botaoVar: "link_orcamento" },
  { tipo: "ORCAMENTO_NAO_RESPONDIDO", nome: "Lembrete de Orçamento Não Respondido", assunto: "Seu orçamento {{numero_orcamento}} ainda aguarda sua resposta",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Notamos que o orçamento <strong>{{numero_orcamento}}</strong> (<strong>{{valor}}</strong>) ainda não foi respondido. Estamos à disposição para tirar dúvidas.</p>",
    botaoLabel: "Ver orçamento", botaoVar: "link_orcamento" },
  { tipo: "ORCAMENTO_VENCENDO", nome: "Orçamento Vencendo", assunto: "Orçamento {{numero_orcamento}} vence em {{dias_para_vencer}} dias",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>O orçamento <strong>{{numero_orcamento}}</strong> vence em <strong>{{dias_para_vencer}}</strong> dia(s). Aproveite as condições antes que expire.</p>",
    botaoLabel: "Aprovar orçamento", botaoVar: "link_orcamento" },
  { tipo: "ORCAMENTO_VENCIDO", nome: "Orçamento Vencido", assunto: "Orçamento {{numero_orcamento}} expirou — podemos renovar?",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>O orçamento <strong>{{numero_orcamento}}</strong> expirou sem resposta. Se ainda tiver interesse, podemos atualizar os valores para você.</p>",
    botaoLabel: "Falar conosco", botaoVar: "link_orcamento" },
  { tipo: "ORCAMENTO_APROVADO_SEM_OS", nome: "Orçamento Aprovado — OS Pendente", assunto: "Orçamento aprovado! Quando podemos agendar o serviço?",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>Obrigado por aprovar o orçamento <strong>{{numero_orcamento}}</strong>! Vamos agendar a execução? Responda este e-mail com a melhor data para você.</p>" },
  { tipo: "OS_CONCLUIDA", nome: "OS Concluída", assunto: "Ordem de serviço {{numero_os}} concluída — {{empresa_nome}}",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>A ordem de serviço <strong>{{numero_os}}</strong> foi concluída. Agradecemos a preferência e ficamos à disposição.</p>",
    botaoLabel: "Ver detalhes", botaoVar: "link_documento" },
  { tipo: "CONTRATO_ASSINATURA", nome: "Contrato para Assinatura", assunto: "Proposta de contrato {{numero_contrato}} aguarda sua assinatura",
    corpo: "<p>Olá <strong>{{cliente_nome}}</strong>,</p><p>A proposta de contrato <strong>{{numero_contrato}}</strong> está pronta e aguarda sua assinatura digital.</p>",
    botaoLabel: "Assinar contrato", botaoVar: "link_documento" },
];

export function substituirVariaveis(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => vars[k] ?? "");
}

export interface DadosEmpresaEmail {
  nome: string; telefone?: string | null; email?: string | null; site?: string | null;
  endereco?: string | null; cidade?: string | null; estado?: string | null; logo?: string | null;
}

/** Monta o HTML final do e-mail com header, corpo, botão e footer. */
export function montarEmailHtml(opts: { empresa: DadosEmpresaEmail; corpoHtml: string; botaoLabel?: string; botaoUrl?: string }): string {
  const { empresa, corpoHtml, botaoLabel, botaoUrl } = opts;
  const botao = botaoLabel && botaoUrl
    ? `<tr><td style="padding:8px 0 24px;text-align:center;"><a href="${botaoUrl}" style="display:inline-block;background:#10B981;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:8px;">${botaoLabel}</a></td></tr>`
    : "";
  const logo = empresa.logo
    ? `<img src="${empresa.logo}" alt="${empresa.nome}" width="40" height="40" style="border-radius:8px;vertical-align:middle;margin-right:10px;" />`
    : "";
  const endereco = [empresa.endereco, empresa.cidade && `${empresa.cidade}${empresa.estado ? "/" + empresa.estado : ""}`].filter(Boolean).join(" — ");
  const contatos = [empresa.telefone, empresa.email, empresa.site].filter(Boolean).join(" · ");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif;color:#1E293B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0;">
        <tr><td style="background:#0F2744;padding:20px 28px;">
          ${logo}<span style="color:#ffffff;font-size:18px;font-weight:700;vertical-align:middle;">${empresa.nome}</span>
        </td></tr>
        <tr><td style="padding:28px;font-size:15px;line-height:1.6;color:#1E293B;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>${corpoHtml}</td></tr>${botao}</table>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;color:#64748B;line-height:1.5;">
          <strong style="color:#334155;">${empresa.nome}</strong><br/>
          ${endereco ? endereco + "<br/>" : ""}${contatos}
        </td></tr>
      </table>
      <p style="font-size:11px;color:#94A3B8;margin:14px 0 0;">Este é um e-mail automático. Por favor, não responda diretamente.</p>
    </td></tr>
  </table>
</body></html>`;
}
