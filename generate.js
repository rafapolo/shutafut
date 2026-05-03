import { DuckDBInstance } from '@duckdb/node-api';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../empresas/empresas.duckdb');
const OUTPUT_PATH = join(__dirname, 'output/network_israel.json');

const ISRAEL_PAIS = 383;
const SITUACAO_MAP = { 1: 'Nula', 2: 'Ativa', 3: 'Suspensa', 4: 'Inapta', 8: 'Baixada' };
const PORTE_MAP    = { 1: 'Micro', 3: 'Pequeno', 5: 'Demais' };

async function runQuery(conn, sql) {
  const result = await conn.run(sql);
  return result.getRows();
}

function nodeProps(type) {
  if (type === 'company')          return { color: '#00c853', radius: 18, originalRadius: 18 };
  if (type === 'israeli_company')  return { color: '#0038b8', radius: 18, originalRadius: 18 };
  if (type === 'israeli_socio')    return { color: '#7eb8f7', radius: 14, originalRadius: 14 };
  return                                  { color: '#ffd600', radius: 10, originalRadius: 10 };
}

async function main() {
  console.log('Opening database:', DB_PATH);
  const instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' });
  const conn = await instance.connect();

  // Step 1a: companies registered in Israel (estabelecimentos.pais = '383')
  console.log('Finding Israeli-registered companies (est.pais=383)...');
  const estIsraeliRows = await runQuery(conn, `
    SELECT DISTINCT cnpj_basico FROM companies.estabelecimentos WHERE pais = '383'
  `);
  console.log(`Found ${estIsraeliRows.length} Israeli-registered companies`);

  // Step 1b: companies with Israeli socios (socios.pais = 383)
  console.log('Finding companies with Israeli socios (socios.pais=383)...');
  const socioIsraeliRows = await runQuery(conn, `
    SELECT DISTINCT cnpj_basico FROM companies.socios WHERE pais = ${ISRAEL_PAIS}
  `);
  console.log(`Found ${socioIsraeliRows.length} companies with Israeli socios`);

  // Union: all unique CNPJs; track which are Israeli-registered
  const israeliCompanyCnpjs = new Set(estIsraeliRows.map(r => String(r[0])));
  const allCnpjSet = new Set([...estIsraeliRows, ...socioIsraeliRows].map(r => String(r[0])));
  console.log(`Total unique companies: ${allCnpjSet.size}`);

  const cnpjList = [...allCnpjSet].map(c => `'${c}'`).join(', ');

  // Step 2: all socios of those companies
  console.log('Fetching socios...');
  const rawRows = await runQuery(conn, `
    SELECT s.cnpj_basico, e.razao_social, s.nome_socio_razao_social,
           s.cpf_cnpj_socio, s.qualificacao_socio, s.pais
    FROM companies.socios s
    JOIN companies.empresas e ON s.cnpj_basico = e.cnpj_basico
    WHERE s.cnpj_basico IN (${cnpjList})
    ORDER BY s.cnpj_basico, s.nome_socio_razao_social
  `);
  const rows = rawRows.map(r => ({
    cnpj_basico: r[0], company_name: r[1], socio_name: r[2],
    cpf_cnpj_socio: r[3], qualificacao_socio: r[4], socio_pais: r[5],
  }));
  console.log(`Got ${rows.length} socio relationships`);

  // Step 3: company details
  console.log('Fetching company details...');
  const detailRows = await runQuery(conn, `
    SELECT est.cnpj_basico, est.nome_fantasia, est.uf, est.pais AS est_pais,
           m.descricao AS municipio,
           est.situacao_cadastral, est.data_inicio_atividade,
           est.cnae_fiscal_principal,
           cn.descricao AS cnae_desc,
           emp.capital_social, emp.porte_empresa,
           nj.descricao AS natureza_juridica,
           emp.razao_social
    FROM companies.estabelecimentos est
    JOIN companies.empresas emp       ON est.cnpj_basico = emp.cnpj_basico
    LEFT JOIN companies.cnaes cn      ON CAST(est.cnae_fiscal_principal AS VARCHAR) = CAST(cn.codigo AS VARCHAR)
    LEFT JOIN companies.municipios m  ON est.municipio = m.codigo
    LEFT JOIN companies.naturezas_juridica nj ON emp.natureza_juridica = nj.codigo
    WHERE est.cnpj_basico IN (${cnpjList})
      AND est.identificador_matriz_filial = 1
  `);

  const companyDetails = new Map();
  for (const r of detailRows) {
    if (!companyDetails.has(r[0])) {
      companyDetails.set(r[0], {
        cnpj_basico:       r[0],
        nome_fantasia:     r[1] || null,
        uf:                r[2] || null,
        est_pais:          r[3] ? Number(r[3]) : null,
        municipio:         r[4] || null,
        situacao:          SITUACAO_MAP[r[5]] || '—',
        data_abertura:     r[6] ? String(r[6]).split('T')[0] : null,
        cnae_code:         r[7] != null ? String(r[7]) : null,
        cnae_desc:         r[8] || null,
        capital_social:    r[9] != null ? r[9] : null,
        porte:             PORTE_MAP[r[10]] || '—',
        natureza_juridica: r[11] || null,
        razao_social:      r[12] || null,
      });
    }
  }
  console.log(`Got details for ${companyDetails.size} companies`);

  // Build graph

  const nodeMap = new Map();
  const nodes = [];
  const links = [];
  const linkSet = new Set();
  const socioIdToCpf = new Map();

  function getOrCreate(key, label, type, extra = {}) {
    if (!nodeMap.has(key)) {
      const id = nodes.length;
      nodes.push({ id, label, type, ...nodeProps(type), ...extra });
      nodeMap.set(key, id);
    }
    return nodeMap.get(key);
  }

  for (const row of rows) {
    const companyKey  = `c:${row.cnpj_basico}`;
    const companyType = israeliCompanyCnpjs.has(String(row.cnpj_basico)) ? 'israeli_company' : 'company';
    const detail      = companyDetails.get(row.cnpj_basico);

    const companyId = getOrCreate(companyKey, row.company_name || row.cnpj_basico, companyType, detail ?? { cnpj_basico: row.cnpj_basico });

    // If cpf_cnpj_socio is a 14-digit CNPJ whose 8-digit base is already in our dataset,
    // merge into the existing company node instead of creating a separate socio node.
    const cleanId = row.cpf_cnpj_socio ? String(row.cpf_cnpj_socio).replace(/\D/g, '') : null;
    const cnpjBase = (cleanId && cleanId.length === 14) ? cleanId.slice(0, 8) : null;
    const isCorporateSocio = cnpjBase && allCnpjSet.has(cnpjBase);

    let socioKey, socioType, socioExtra;
    if (isCorporateSocio) {
      socioKey  = `c:${cnpjBase}`;
      socioType = israeliCompanyCnpjs.has(cnpjBase) ? 'israeli_company' : 'company';
      const sd  = companyDetails.get(cnpjBase) || { cnpj_basico: cnpjBase };
      socioExtra = sd;
    } else {
      socioKey   = `s:${row.cpf_cnpj_socio || row.socio_name}:${row.socio_pais ?? 0}`;
      socioType  = row.socio_pais === ISRAEL_PAIS ? 'israeli_socio' : 'socio';
      socioExtra = { cpf_cnpj_socio: row.cpf_cnpj_socio || null, pais: row.socio_pais ?? null };
    }

    const socioLabel = isCorporateSocio
      ? (companyDetails.get(cnpjBase)?.razao_social || row.socio_name || cnpjBase)
      : (row.socio_name || '(sem nome)');
    const socioId = getOrCreate(socioKey, socioLabel, socioType, socioExtra);

    if (!isCorporateSocio && row.cpf_cnpj_socio) socioIdToCpf.set(socioId, row.cpf_cnpj_socio);

    const linkKey = `${companyId}-${socioId}-${row.qualificacao_socio}`;
    if (!linkSet.has(linkKey)) {
      linkSet.add(linkKey);
      links.push({ source: companyId, target: socioId, qualificacao_socio: row.qualificacao_socio });
    }
  }

  // Ensure all 394 Israeli-registered companies appear as nodes even without socios
  for (const cnpj of israeliCompanyCnpjs) {
    const companyKey = `c:${cnpj}`;
    if (!nodeMap.has(companyKey)) {
      const detail = companyDetails.get(cnpj) || { cnpj_basico: cnpj };
      const name   = detail.razao_social || detail.nome_fantasia || cnpj;
      getOrCreate(companyKey, name, 'israeli_company', detail);
    }
  }

  console.log(`Graph: ${nodes.length} nodes, ${links.length} links`);
  console.log(`  Emp. brasileiras:     ${nodes.filter(n => n.type === 'company').length}`);
  console.log(`  Emp. israelenses:     ${nodes.filter(n => n.type === 'israeli_company').length}`);
  console.log(`  Sócios israelenses:   ${nodes.filter(n => n.type === 'israeli_socio').length}`);
  console.log(`  Outros sócios:        ${nodes.filter(n => n.type === 'socio').length}`);

  const paisMap = {
    76: 'Brasil', 105: 'EUA', 158: 'Reino Unido', 161: 'Rússia',
    163: 'El Salvador', 171: 'Suíça', 175: 'Turquia', 181: 'Uruguai',
    191: 'Venezuela', 245: 'França', 249: 'Alemanha', 251: 'Itália',
    252: 'Espanha', 253: 'Portugal', 254: 'Holanda', 308: 'China',
    351: 'Japão', 383: 'Israel', 386: 'Líbano', 388: 'Síria',
    399: 'Argentina', 403: 'Bolívia', 431: 'Canadá', 432: 'Chile',
    453: 'Colômbia', 492: 'Equador', 531: 'México', 589: 'Paraguai',
    599: 'Peru', 628: 'Áustria', 684: 'Bélgica', 764: 'Hungria',
    795: 'Polônia',
  };

  const qualificacaoSocioMap = {
    0: 'Não informada', 5: 'Administrador', 8: 'Conselheiro de Administração',
    9: 'Curador', 10: 'Diretor', 11: 'Interventor', 12: 'Inventariante',
    13: 'Liquidante', 14: 'Mãe', 15: 'Pai', 16: 'Presidente', 17: 'Procurador',
    18: 'Secretário', 19: 'Síndico (Condomínio)', 20: 'Sociedade Consorciada',
    21: 'Sociedade Filiada', 22: 'Sócio', 23: 'Sócio Capitalista',
    24: 'Sócio Comanditado', 25: 'Sócio Comanditário', 26: 'Sócio de Indústria',
    28: 'Sócio-Gerente', 29: 'Sócio Incapaz ou Relat.Incapaz (exceto menor)',
    30: 'Sócio Menor (Assistido/Representado)', 31: 'Sócio Ostensivo',
    32: 'Tabelião', 33: 'Tesoureiro', 34: 'Titular de Empresa Individual Imobiliária',
    35: 'Tutor', 37: 'Sócio Pessoa Jurídica Domiciliado no Exterior',
    38: 'Sócio Pessoa Física Residente no Exterior', 39: 'Diplomata', 40: 'Cônsul',
    41: 'Representante de Organização Internacional', 42: 'Oficial de Registro',
    43: 'Responsável', 46: 'Ministro de Estado das Relações Exteriores',
    47: 'Sócio Pessoa Física Residente no Brasil',
    48: 'Sócio Pessoa Jurídica Domiciliado no Brasil',
    49: 'Sócio-Administrador', 50: 'Empresário',
    51: 'Candidato a cargo Político Eletivo', 52: 'Sócio com Capital',
    53: 'Sócio sem Capital', 54: 'Fundador',
    55: 'Sócio Comanditado Residente no Exterior',
    56: 'Sócio Comanditário Pessoa Física Residente no Exterior',
    57: 'Sócio Comanditário Pessoa Jurídica Domiciliado no Exterior',
    58: 'Sócio Comanditário Incapaz', 59: 'Produtor Rural',
    60: 'Cônsul Honorário', 61: 'Responsável indígena',
    62: 'Representante da Instituição Extraterritorial',
    63: 'Cotas em Tesouraria', 64: 'Administrador Judicial',
    65: 'Titular Pessoa Física Residente ou Domiciliado no Brasil',
    66: 'Titular Pessoa Física Residente ou Domiciliado no Exterior',
    67: 'Titular Pessoa Física Incapaz ou Relativamente Incapaz (exceto menor)',
    68: 'Titular Pessoa Física Menor (Assistido/Representado)',
    69: 'Beneficiário Final', 70: 'Administrador Residente ou Domiciliado no Exterior',
    71: 'Conselheiro de Administração Residente ou Domiciliado no Exterior',
    72: 'Diretor Residente ou Domiciliado no Exterior',
    73: 'Presidente Residente ou Domiciliado no Exterior',
    74: 'Sócio-Administrador Residente ou Domiciliado no Exterior',
    75: 'Fundador Residente ou Domiciliado no Exterior',
    78: 'Titular Pessoa Jurídica Domiciliada no Brasil',
    79: 'Titular Pessoa Jurídica Domiciliada no Exterior',
  };

  mkdirSync(join(__dirname, 'output'), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify({ nodes, links, paisMap, qualificacaoSocioMap }));
  console.log(`Written to ${OUTPUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
