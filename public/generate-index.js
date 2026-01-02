const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const os = require('os');

const GITHUB_USER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'likdanil';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'release';
const repoBaseUrl = `https://${GITHUB_USER.toLowerCase()}.github.io/${GITHUB_REPO}`;
const rootDirs = ['keenetic'];
const isGitHubCI = process.env.GITHUB_ACTIONS === 'true';
const repoRoot = isGitHubCI ? path.resolve(process.cwd()) : __dirname;

const embeddedCSS = `
body { font-family: sans-serif; background: #f8f8f8; color: #222; padding: 20px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
th { background: #f0f0f0; cursor: pointer; }
.search { margin: 10px 0; padding: 5px; width: 200px; }
a { color: #0366d6; text-decoration: none; }
a:hover { text-decoration: underline; }
`;

function compareVersions(v1, v2) {
  const normalize = v => v.replace(/[^0-9]/g, '').padStart(8, '0');
  return parseInt(normalize(v1)) - parseInt(normalize(v2));
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

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
    // IPK файл - это AR архив, содержащий: debian-binary, control.tar.gz, data.tar.gz
    // Сначала проверяем наличие ar команды
    let hasAr = false;
    try {
      execSync('ar --version', { stdio: 'ignore' });
      hasAr = true;
    } catch (e) {
      hasAr = false;
    }

    let controlTarPath;
    if (hasAr) {
      // Используем ar для извлечения control.tar.gz из AR архива
      execSync(`ar x "${ipkPath}" control.tar.gz`, { cwd: tmpDir });
      controlTarPath = path.join(tmpDir, 'control.tar.gz');
    } else {
      // Альтернативный метод: парсим AR архив вручную
      // AR формат: Global header "!<arch>\n" (8 байт) + записи файлов
      // Каждая запись: 60-байтовый заголовок + данные файла
      const ipkBuffer = fs.readFileSync(ipkPath);
      
      // Проверяем AR magic header
      const magic = ipkBuffer.slice(0, 8).toString('ascii');
      if (magic !== '!<arch>\n') {
        throw new Error('Invalid AR archive format');
      }
      
      let offset = 8; // Пропускаем "!<arch>\n"
      
      while (offset + 60 <= ipkBuffer.length) {
        // Читаем заголовок (60 байт)
        const header = ipkBuffer.slice(offset, offset + 60);
        
        // Имя файла (16 байт) - читаем до первого нулевого байта или пробела
        let fileNameBytes = header.slice(0, 16);
        let fileNameEnd = 16;
        for (let i = 0; i < 16; i++) {
          if (fileNameBytes[i] === 0 || fileNameBytes[i] === 0x20) {
            fileNameEnd = i;
            break;
          }
        }
        let fileName = fileNameBytes.slice(0, fileNameEnd).toString('ascii');
        // Убираем завершающий слеш, если есть
        fileName = fileName.replace(/\/$/, '');
        
        // Размер файла (10 байт, позиция 48-58)
        const sizeStr = header.slice(48, 58).toString('ascii').trim();
        const fileSize = parseInt(sizeStr, 10);
        
        // Проверяем magic bytes (58-60: 0x60 0x0A) - должны быть 0x60 0x0A
        const magicByte1 = header[58];
        const magicByte2 = header[59];
        if (magicByte1 !== 0x60 || magicByte2 !== 0x0A) {
          // Неверный формат записи, пропускаем
          break;
        }
        
        if (isNaN(fileSize) || fileSize < 0 || fileSize > ipkBuffer.length) {
          break; // Некорректный размер, выходим
        }
        
        offset += 60; // Переходим к данным
        
        // Проверяем, что это control.tar.gz
        if (fileName === 'control.tar.gz' && fileSize > 0) {
          const fileData = ipkBuffer.slice(offset, offset + fileSize);
          controlTarPath = path.join(tmpDir, 'control.tar.gz');
          fs.writeFileSync(controlTarPath, fileData);
          break;
        }
        
        // Переходим к следующей записи (выравнивание по 2 байта)
        offset += fileSize;
        if (fileSize % 2 === 1) {
          offset += 1; // Padding byte
        }
      }
      
      if (!controlTarPath || !fs.existsSync(controlTarPath)) {
        // Попробуем найти все файлы в архиве для отладки
        const foundFiles = [];
        let debugOffset = 8;
        while (debugOffset + 60 <= ipkBuffer.length) {
          const debugHeader = ipkBuffer.slice(debugOffset, debugOffset + 60);
          let debugNameBytes = debugHeader.slice(0, 16);
          let debugNameEnd = 16;
          for (let i = 0; i < 16; i++) {
            if (debugNameBytes[i] === 0 || debugNameBytes[i] === 0x20) {
              debugNameEnd = i;
              break;
            }
          }
          const debugName = debugNameBytes.slice(0, debugNameEnd).toString('ascii').replace(/\/$/, '');
          foundFiles.push(debugName);
          const debugSize = parseInt(debugHeader.slice(48, 58).toString('ascii').trim(), 10);
          debugOffset += 60 + debugSize + (debugSize % 2 === 1 ? 1 : 0);
        }
        throw new Error(`control.tar.gz not found in AR archive. Found files: ${foundFiles.join(', ')}`);
      }
    }

    // Распаковываем control.tar.gz
    execSync(`tar -xzf "${controlTarPath}"`, { cwd: tmpDir });
    const controlPath = path.join(tmpDir, 'CONTROL', 'control');
    
    // Проверяем альтернативные пути
    let controlContent;
    if (fs.existsSync(controlPath)) {
      controlContent = fs.readFileSync(controlPath).toString();
    } else {
      // Иногда control может быть в корне распакованного архива
      const altPath = path.join(tmpDir, 'control');
      if (fs.existsSync(altPath)) {
        controlContent = fs.readFileSync(altPath).toString();
      } else {
        throw new Error('control file not found in control.tar.gz');
      }
    }
    
    return parseControlFields(controlContent);
  } catch (e) {
    console.error(`⚠️ Failed to parse .ipk: ${ipkPath}`);
    console.error(`   Error: ${e.message}`);
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
    const block = [
      `Package: ${control.Package}`,
      `Version: ${control.Version}`,
      `Architecture: ${control.Architecture}`,
      `Maintainer: ${control.Maintainer || 'unknown'}`,
      `Depends: ${control.Depends || ''}`,
      `Section: ${control.Section || 'base'}`,
      `Priority: ${control.Priority || 'optional'}`,
      `Filename: ${entry.filename}`,
      `Size: ${entry.size}`,
      `Description: ${control.Description || ''}`,
      ''
    ].join('\n');
    packages.push(block);
  }

  const allText = packages.join('\n');
  fs.writeFileSync(path.join(dir, 'Packages'), allText);
  fs.writeFileSync(path.join(dir, 'Packages.gz'), zlib.gzipSync(allText));

  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Packages in /${relPath}</title>
<style>${embeddedCSS}</style>
</head>
<body>
<h1>Packages in /${relPath}</h1>
<table>
<thead><tr><th>Name</th><th>Version</th><th>Section</th><th>Description</th></tr></thead>
<tbody>`;
  for (const block of packages) {
    const lines = block.split('\n');
    const data = {};
    lines.forEach(line => {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) {
        data[key.trim()] = rest.join(':').trim();
      }
    });
    html += `<tr><td><a href="${data.Filename}">${data.Package}</a></td><td>${data.Version}</td><td>${data.Section || ''}</td><td>${data.Description || ''}</td></tr>`;
  }
  html += '</tbody></table></body></html>';
  fs.writeFileSync(path.join(dir, 'Packages.html'), html);
}

function generateIndexForDir(currentPath, rootDirAbs, rootDirRel) {
  generatePackagesFiles(currentPath, path.posix.join(rootDirRel, path.relative(rootDirAbs, currentPath).replace(/\\/g, '/')));

  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  const relativePathFromRoot = path.relative(rootDirAbs, currentPath).replace(/\\/g, '/');
  const fullPathFromRepo = path.posix.join(rootDirRel, relativePathFromRoot);
  const folderUrl = `/${fullPathFromRepo}/`.replace(/\/+/g, '/');
  const baseHref = `${repoBaseUrl}/${fullPathFromRepo}/`.replace(/\\+/g, '/').replace(/([^:]\/)\/+/g, '$1');

  const files = entries.filter(e => e.isFile() && e.name !== 'index.html')
    .map(e => ({ name: e.name, size: formatSize(fs.statSync(path.join(currentPath, e.name)).size) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const dirs = entries.filter(e => e.isDirectory())
    .map(e => ({ name: e.name + '/', size: '-' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parentPath = fullPathFromRepo.split('/').slice(0, -1).join('/');
  const parentUrl = parentPath ? `${repoBaseUrl}/${parentPath}/` : `${repoBaseUrl}/`;

  const rows = [
    { name: '..', size: '', href: parentUrl },
    ...dirs.map(d => ({ ...d, href: `${baseHref}${encodeURI(d.name)}` })),
    ...files.map(f => ({ ...f, href: `${baseHref}${encodeURI(f.name)}` }))
  ];

  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Index of ${folderUrl}</title>
<style>
body { font-family: monospace; padding: 2em; background: #fafafa; color: #333; }
table { width: 100%; max-width: 800px; border-collapse: collapse; }
td { padding: 0.3em 0.6em; border-bottom: 1px solid #ddd; }
td.size { text-align: right; color: #666; white-space: nowrap; }
a { color: #0366d6; text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { margin-bottom: 1em; }
</style></head><body>
<h1>Index of ${folderUrl}</h1>
<table>`;
  for (const row of rows) {
    html += `<tr><td><a href="${row.href}">${row.name}</a></td><td class="size">${row.size}</td></tr>\n`;
  }
  html += '</table></body></html>';
  fs.writeFileSync(path.join(currentPath, 'index.html'), html, 'utf-8');
}

function walkAndGenerate(currentDir, rootDirAbs, rootDirRel) {
  generateIndexForDir(currentDir, rootDirAbs, rootDirRel);
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