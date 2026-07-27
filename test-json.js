import fs from 'fs';
try {
  const content = fs.readFileSync('./google-key.json', 'utf8');
  JSON.parse(content);
  console.log('✅ JSON is valid');
} catch (e) {
  console.error('❌ JSON is invalid:', e.message);
}
