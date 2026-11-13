# Prints e foto da home de vendas

Coloque aqui as telas reais do sistema, **com exatamente estes nomes**. A página (`/`) troca o espaço
reservado pela imagem sozinha, sem mexer em código. Extensões aceitas: `.webp` (preferida), `.avif`,
`.png` ou `.jpg`.

| # | Arquivo | Tela | Formato | Onde aparece | Situação |
|---|---|---|---|---|---|
| 1 | `01-dashboard` | Dashboard | computador | Hero (notebook) | falta o arquivo |
| 2 | `02-calendario-os` | Calendário de OS | computador | Ordens de serviço | falta o arquivo |
| 3 | `03-orcamento-aprovado` | Orçamento com aprovação | computador | Financeiro — print principal, em destaque | falta o arquivo |
| 4 | `04-orcamentos` | Orçamentos | computador | Financeiro — miniatura | falta o arquivo |
| 5 | `05-contratos` | Contratos | computador | Financeiro — miniatura | falta o arquivo |
| 6 | `06-estoque` | Estoque | computador | Estoque, compras e materiais | no lugar |
| 7 | `07-mapa-tecnicos` | Mapa dos técnicos | computador | Mapa da equipe — em destaque | no lugar |
| 8 | `08-equipes` | Equipes | computador | Desempenho da equipe — print principal | no lugar |
| 9 | `09-colaboradores` | Colaboradores | computador | Desempenho da equipe — abaixo do principal | no lugar |
| 10 | `10-financeiro` | Financeiro | computador | Financeiro — miniatura | no lugar |
| 11 | `11-app-tecnico` | App do técnico (Meu dia / execução) | celular | Hero (celular) e Ordens de serviço | não enviado |
| 12 | `12-pmoc` | PMOC (cronograma + documento PDF) | computador | PMOC automático | não enviado |
| 13 | `13-aceite` | Aceite (assinatura + estrelas) | celular | Aceite e avaliação | não enviado |
| 14 | `14-equipamento-qr` | Equipamento + QR | computador | Equipamentos com QR | não enviado |

Os prints já no lugar foram recortados só na área da tela: sem a barra lateral e sem a barra do topo (que
mostra o e-mail do usuário). Equipes (08), colaboradores (09) e estoque (06) ficaram só com a parte que tem
conteúdo, para o texto aparecer maior; o 09 saiu sem a coluna Contato (telefone e e-mail do colaborador) e o
mapa (07) teve a coordenada do técnico borrada. Um recorte fora de 16:10 precisa da `proporcao` do print em
`components/marketing/conteudo.ts`.

## Foto (seção "Por que o Frivo existe")

| Arquivo | O quê | Onde aparece |
|---|---|---|
| `foto-equipe` | Foto real da equipe / em campo | Ao lado do texto "Feito por climatização. Para climatização." |

Qualquer orientação serve, com pelo menos 1200 px no lado menor. No computador a foto aparece em pé (4:5) e
no celular deitada (4:3), cortada pelo centro — deixe as pessoas no meio do quadro.

## Tamanho dos prints

- **Computador:** proporção 16:10 — 1600 × 1000 px (janela do navegador em 1280 × 800, captura em 2x, já sem a barra do navegador).
- **Celular:** proporção 9:19 — 780 × 1646 px (tela de 390 px de largura, captura em 2x).

Fora da proporção a imagem é cortada (mantém o topo). Não precisa comprimir à mão: a página entrega
cada print no tamanho da tela de quem abre, em WebP/AVIF.

## Antes de publicar

Confira o que cada tela mostra: nome, telefone, e-mail, endereço e valores de clientes e de colaboradores
ficam visíveis para qualquer visitante.
