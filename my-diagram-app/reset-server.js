import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectFile = path.join(__dirname, 'mcp-server', 'projects.json');

console.log('--- Server Data Reset ---');

// プロジェクト一覧ファイル (projects.json) を削除
if (fs.existsSync(projectFile)) {
  try {
    fs.unlinkSync(projectFile);
    console.log(`✅ Successfully deleted project list file: ${projectFile}`);
  } catch (err) {
    console.error(`❌ Error deleting project list file: ${projectFile}`, err);
  }
} else {
  console.log(`ℹ️ Project list file not found, nothing to delete: ${projectFile}`);
}
console.log('-------------------------\nServer reset complete. Please also clear your browser data (LocalStorage, IndexedDB) and restart the servers.');