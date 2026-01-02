// Скрипт для автоматической генерации Packages и Packages.gz файлов
// Основан на скрипте Ground-Zerro: https://github.com/Ground-Zerro/release/blob/main/public/generate-index.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const os = require('os');

const GITHUB_USER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'likDanil';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'release';
const repoBaseUrl = `https://${GITHUB_USER.toLowerCase()}.github.io/${GITHUB_REPO}`;
const rootDirs = ['keenetic'];
const isGitHubCI = process.env.GITHUB_ACTIONS === 'true';
const repoRoot = isGitHubCI ? path.resolve(process.cwd()) : __dirname;

function parseControlFields(content) {
  const result = {};
  content.split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      result[key.trim()] = rest.join(':').trim();
    }
  });
  return result;
}

function extractControlFromIpk(ipkPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipk-'));
  try {
    const controlTar = execSync(`tar -xOf "${ipkPath}" control.tar.gz`, { encoding: null });
    fs.writeFileSync(path.join(tmpDir, 'control.tar.gz'), controlTar);
    execSync(`tar -xzf control.tar.gz`, { cwd: tmpDir });
    const controlContent = fs.readFileSync(path.join(tmpDir, 'control')).toString();
    return parseControlFields(controlContent);
  } catch (e) {
    console.error(`⚠️ Failed to parse .ipk: ${ipkPath}`);
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function generatePackagesFiles(dir, relPath) {
  const entries = fs.readdirSync(dir);
  const ipkFiles = entries.filter(f => f.endsWith('.ipk'));
  if (ipkFiles.length === 0) return;

  const packageEntries = [];

  for (const file of ipkFiles) {
    const ipkPath = path.join(dir, file);
    const control = extractControlFromIpk(ipkPath);
    if (!control || !control.Package || !control.Version || !control.Architecture) continue;

    packageEntries.push({
      name: control.Package,
      version: control.Version,
      arch: control.Architecture,
      filename: file,
      size: fs.statSync(ipkPath).size,
      control
    });
  }

  // Выбор только самых новых версий
  const latestMap = {};
  for (const entry of packageEntries) {
    const key = `${entry.name}_${entry.arch}`;
    if (!latestMap[key] || compareVersions(entry.version, latestMap[key].version) > 0) {
      latestMap[key] = entry;
    }
  }

  const finalPackages = Object.values(latestMap);
  const packages = [];
  for (const entry of finalPackages) {
    const control = entry.control;
    const md5 = require('crypto').createHash('md5')
      .update(fs.readFileSync(path.join(dir, entry.filename)))
      .digest('hex');
    
    const block = [
      `Package: ${control.Package}`,
      `Version: ${control.Version}`,
      `Architecture: ${control.Architecture}`,
      `Maintainer: ${control.Maintainer || 'Domain Server Team'}`,
      control.Depends ? `Depends: ${control.Depends}` : '',
      `Section: ${control.Section || 'base'}`,
      `Priority: ${control.Priority || 'optional'}`,
      `Filename: ${entry.filename}`,
      `Size: ${entry.size}`,
      `MD5Sum: ${md5}`,
      `Description: ${control.Description || ''}`,
      ''
    ].filter(Boolean).join('\n');
    packages.push(block);
  }

  const allText = packages.join('\n');
  fs.writeFileSync(path.join(dir, 'Packages'), allText);
  fs.writeFileSync(path.join(dir, 'Packages.gz'), zlib.gzipSync(allText));
  
  console.log(`✅ Generated Packages and Packages.gz for ${relPath}`);
}

function compareVersions(v1, v2) {
  const normalize = v => v.replace(/[^0-9]/g, '').padStart(8, '0');
  return parseInt(normalize(v1)) - parseInt(normalize(v2));
}

function walkAndGenerate(currentDir, rootDirAbs, rootDirRel) {
  generatePackagesFiles(currentDir, path.relative(rootDirAbs, currentDir).replace(/\\/g, '/'));
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      walkAndGenerate(path.join(currentDir, entry.name), rootDirAbs, rootDirRel);
    }
  }
}

for (const rootDirRel of rootDirs) {
  const rootDirAbs = path.join(repoRoot, rootDirRel);
  if (fs.existsSync(rootDirAbs)) {
    walkAndGenerate(rootDirAbs, rootDirAbs, rootDirRel);
  } else {
    console.warn(`⚠ Directory not found: ${rootDirRel}`);
  }
}

console.log('✅ All Packages files generated!');

