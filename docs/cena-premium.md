# Cena do projeto — lapidação visual (render arquitetônico premium)

Lapidação **só visual** da cena do projeto da calculadora pública `/calculadora`
(`components/publico/cena-projeto.tsx`). O wizard, o cálculo de BTU e a captura do
lead não mudaram — a cena antes era simples demais (aparelho como um retângulo
chapado, "flocos" com cara de asterisco, cômodo como uma caixa vazia). Agora é um
render isométrico com profundidade, móveis de contexto, aparelho reconhecível por
tipo e ar frio elegante.

## O que mudou

- **Cômodo arquitetônico com profundidade**: paredes com gradiente (face direita
  mais iluminada, esquerda mais escura), rodapé, **janela com luz do dia** entrando
  num feixe até o piso, **piso com grade em perspectiva** que esmaece ao fundo,
  oclusão de ambiente (sombra suave no canto), sombra de contato do cômodo e
  **vinheta** por cima — a sensação é de um render, não de um ícone.
- **Móveis por tipo de ambiente** (silhueta isométrica, por token): quarto → cama +
  travesseiro; sala → sofá + TV na parede; cozinha → bancada; escritório → mesa;
  loja → balcão; salão → mesas; galpão → prateleiras.
- **Aparelho reconhecível e detalhado por forma**:
  - **hi-wall** — corpo horizontal clássico no alto da parede, com aletas/vent na
    base, vinco superior e um LED;
  - **piso-teto** — gabinete alto no piso, com grelha e LED;
  - **cassete** — quadrado embutido no teto, com saídas nos 4 lados e LED;
  - **multisplit / VRF** — **condensadora externa** (gabinete + grade do ventilador)
    com **tubulação** entrando no cômodo e **várias unidades internas**.
- **Ar frio elegante**: cone de luz fria saindo da unidade, **névoa/vapor** em ciano
  com desfoque (filtro SVG) descendo, **flocos de neve de 6 pontas de verdade**
  (ramificados, tamanhos/opacidades/quedas variados, sem cara de asterisco) e um
  **indicador de temperatura** (chip "21°") — a cena "esfria" o ambiente.
- **Movimento fluido**: o cômodo monta ao surgir (`anim-calc-entra`), a unidade
  "assenta" ao instalar (`anim-calc-settle`), o ar flui continuamente (cone, névoa e
  flocos). Tudo desligado em `prefers-reduced-motion`.

## Tokens e regras (sem furar o ratchet)

- Cores só por token: a cena ganhou/ajustou tokens em `lib/ui/tokens.ts` (`cena.*` —
  paredes, piso, luz, janela/vidro, móveis, equipamento, LED, neve). Os móveis
  ficaram um tom mais claros para ter presença sem virar desenho.
- O SVG lê as cores por **variáveis CSS** (`--cena-*`, na classe `.cena-vars` em
  `app/globals.css`, que o ratchet não varre) — assim nenhum hex cru entra nos
  componentes. As animações (`calcFloco`, `calcMist`, `calcCone`, `calcBrilho`,
  `calcEntra`, `calcSettle`) ficam no `globals.css`, fora do ratchet, e todas param
  em `prefers-reduced-motion`.
- **Acessível**: o SVG tem `role="img"` e `aria-label`; a contagem de partículas é
  modesta (9 flocos) para manter o desempenho.
- **Responsivo**: no celular a cena empilha **acima** da pergunta, em largura cheia e
  com destaque (é a estrela) — ver os prints de celular.

## Fora (de propósito)

Qualquer mudança no cálculo de BTU, no wizard (estrutura/passos) ou na captura do
lead. A única alteração no wizard foi passar o `tipo` do ambiente para a cena
(`<CenaProjeto … tipo={atual?.tipo} />`), para os móveis combinarem com o ambiente —
é fiação visual, não muda passos nem regra.

## Testes

- `calculadora-wizard-ui` ganhou asserções da cena (DOM): com área, a unidade está
  instalada e o **ar frio** aparece; sem conjunto **não** há condensadora externa;
  vários ambientes mostram a **condensadora externa** e **mais de uma** unidade
  interna; e a cena desenha os **móveis do tipo** escolhido (galpão → prateleiras).
- Rodada de mutação da cena (4/4 mortas): `conjunto` sempre falso, `nInt` sempre 1,
  ar frio sem o gate `ativo`, e galpão sem prateleiras — cada uma derruba o teste.
- `btu-calculo` e o ratchet seguem verdes; a suíte completa roda sozinha.

## Prints

Em `docs/prints/cena-premium/` (desktop e celular). As imagens `antes-*` são a cena
anterior (do #143) para comparação:

- `antes-02-hi-wall-pequeno.png` × `02-passo-tamanho-pequeno.png` — hi-wall pequeno;
- `antes-03-cassete-grande.png` × `03-ambiente-grande-cassete.png` — cassete grande;
- `antes-05-multisplit.png` × `05-varios-ambientes-conjunto.png` — multisplit/vários;
- `antes-08-celular.png` × `08-celular-passo.png` — celular.
