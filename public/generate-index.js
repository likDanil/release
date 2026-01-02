const fs = require('fs');
const path = require('path');

function formatSize(bytes) {
  if (bytes === 0) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function generateIndex(dir, basePath = '') {
  const items = fs.readdirSync(dir)
    .filter(item => item !== 'index.html' && item !== '.git')
    .map(item => {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      return {
        name: item,
        isDir: stat.isDirectory(),
        size: stat.isFile() ? stat.size : null,
        path: path.join(basePath, item)
      };
    })
    .sort((a, b) => {
      // Директории первыми
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Index of ${basePath || '/'}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 40px; background: #f5f5f5; }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #333; margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background-color: #f8f9fa; font-weight: 600; color: #555; }
    tr:hover { background-color: #f9f9f9; }
    a { color: #0366d6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .size { color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Index of ${basePath || '/'}</h1>
    <table>
      <tr>
        <th>Name</th>
        <th>Size</th>
      </tr>
      ${basePath ? '<tr><td><a href="../">[..]</a></td><td>-</td></tr>' : ''}
      ${items.map(item => {
        // Для файлов в той же директории используем только имя файла (относительный путь)
        // Для поддиректорий используем путь с именем директории
        const linkPath = item.isDir ? item.name + '/' : item.name;
        return `
      <tr>
        <td><a href="${linkPath}">${item.name}${item.isDir ? '/' : ''}</a></td>
        <td class="size">${item.isDir ? '-' : formatSize(item.size)}</td>
      </tr>
      `;
      }).join('')}
    </table>
  </div>
</body>
</html>`;

  // Сохраняем index.html в текущей директории
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(`Generated: ${path.join(dir, 'index.html')}`);

  // Рекурсивно обрабатываем поддиректории
  items.filter(item => item.isDir).forEach(item => {
    generateIndex(path.join(dir, item.name), item.path);
  });
}

// Генерируем индексы для всех папок
const releaseDir = path.join(__dirname, '..', 'keenetic');
if (fs.existsSync(releaseDir)) {
  // Используем пустой basePath для корневой директории keenetic
  // чтобы ссылки были относительными от текущей директории
  generateIndex(releaseDir, '');
  console.log('✅ Index pages generated successfully!');
} else {
  console.error('❌ Directory "keenetic" not found!');
  process.exit(1);
}

