# Empresas Israelenses no Brasil

Visualização interativa da rede de sociedades entre empresas israelenses e brasileiras, com base nos dados públicos do CNPJ federal.

## O que mostra

- **Empresas israelenses** (azul escuro) — estabelecimentos com país de origem Israel (`pais = 383`) no cadastro da Receita Federal
- **Empresas brasileiras** (verde) — empresas brasileiras que possuem ao menos um sócio israelense
- **Sócios israelenses** (azul claro) — pessoas físicas ou jurídicas com nacionalidade israelense
- **Outros sócios** (amarelo) — demais sócios das empresas acima

Arestas representam vínculos societários. Empresas registradas como sócias de outras empresas são conectadas diretamente como nós de empresa (não duplicados como sócios).

## Requisitos

- [Bun](https://bun.sh) — runtime e gerenciador de pacotes
- Base de dados DuckDB do CNPJ em `../empresas/empresas.duckdb` (acesso somente leitura)

## Uso

```bash
# Instalar dependências
bun install

# Gerar dados da rede (lê o DuckDB, escreve output/network_israel.json)
bun generate.js

# Servir o visualizador
bunx serve .
# ou qualquer servidor HTTP estático apontando para este diretório
```

Abrir `http://localhost:3000` (ou a porta do servidor) no navegador.

## Filtros disponíveis

| Filtro | Descrição |
|--------|-----------|
| Tipo de nó | Oculta/exibe cada categoria pela legenda |
| Situação | Filtra por situação cadastral (Ativa, Baixada, Inapta, Suspensa) |
| CNAE | Filtra por atividade econômica principal |
| Ano | Mostra empresas fundadas até um determinado ano, ou exatamente naquele ano ("exato") |

Clique em qualquer nó para ver detalhes e conexões. O link da URL reflete o nó selecionado e pode ser compartilhado.

## Estrutura

```
generate.js               — extrai dados do DuckDB e gera output/network_israel.json
cosmograph-viz-israel.js  — lógica de visualização (D3.js, canvas)
index.html                — interface
output/network_israel.json — dados gerados (não versionado)
```
