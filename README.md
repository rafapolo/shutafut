# shutafut — שׁוּתָפוּת

> *shutafut* (שׁוּתָפוּת) — parceria, sociedade empresarial em hebraico
---

Visualização interativa da rede de empresas e sócios israelenses no brasil, com base nos dados públicos do CNPJ federal.

**[→ Abrir visualização](https://rafapolo.github.io/shutafut)**

<div align="center">
    <img src="demo.jpg" alt="demo" width="1000px"/>
</div>

---

## O que mostra

| Nó | Cor | Descrição |
|----|-----|-----------|
| Empresa israelense | Azul escuro | Estabelecimentos com país de origem Israel (`pais = 383`) no cadastro da Receita Federal |
| Empresa brasileira | Verde | Empresas brasileiras com ao menos um sócio israelense |
| Sócio israelense | Azul claro | Pessoas físicas ou jurídicas com nacionalidade israelense |
| Outro sócio | Amarelo | Demais sócios das empresas acima |

Arestas representam vínculos societários. Empresas registradas como sócias de outras empresas aparecem como nós de empresa (sem duplicação).

## Filtros disponíveis

| Filtro | Descrição |
|--------|-----------|
| Tipo de nó | Oculta/exibe cada categoria pela legenda |
| Situação | Filtra por situação cadastral (Ativa, Baixada, Inapta, Suspensa) |
| CNAE | Filtra por atividade econômica principal |
| Ano | Mostra empresas fundadas até um ano, ou exatamente naquele ano |

Clique em qualquer nó para ver detalhes, conexões e situação cadastral. A URL reflete o nó selecionado e pode ser compartilhada.

---

## Rodar localmente

```bash
bun install   # instala dependências (apenas para geração de dados)
bunx serve .  # ou qualquer servidor HTTP estático
```

Abrir `http://localhost:3000` no navegador.

## Gerar os dados

O script `generate.js` lê um banco DuckDB local com os dados públicos da Receita Federal e gera `output/network_israel.json`.

```bash
bun generate.js
```

Requer o banco `../empresas/empresas.duckdb` com as tabelas `companies.estabelecimentos`, `companies.socios`, `companies.empresas`, `companies.cnaes`, `companies.municipios` e `companies.naturezas_juridica`.

Os dados públicos do CNPJ estão disponíveis em [dados.gov.br](https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj).

---

## Fontes

- Cadastro Nacional de Pessoas Jurídicas (CNPJ) — Receita Federal do Brasil
- Código de país `383` identifica Israel no padrão ISO adotado pela Receita
