// Versão do app do Windows = a do site/APK (package.json da raiz). "5.20" vira "5.20.0": o instalador e a
// atualização automática exigem x.y.z. Roda antes de cada pacote (npm run pasta / npm run windows).
const fs = require('fs');
const path = require('path');

const raiz = require('../package.json').version;
const versao = raiz.split('.').length === 2 ? `${raiz}.0` : raiz;
const arquivo = path.join(__dirname, 'package.json');
const pacote = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
pacote.version = versao;
fs.writeFileSync(arquivo, JSON.stringify(pacote, null, 2) + '\n');
console.log(`versão do app do Windows: ${versao}`);
