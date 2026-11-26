import assert from 'node:assert/strict';
import{photoSource,formatEntryDate}from'../photos.js';
const id='1AbcDefGhij_KLmn-opQ123456789';
for(const url of[`https://drive.google.com/file/d/${id}/view?usp=sharing`,`https://drive.google.com/open?id=${id}`,`https://drive.google.com/uc?id=${id}&export=view`,`https://drive.google.com/file/d/${id}/preview`]){
 const src=photoSource(url);assert.equal(src.kind,'drive');assert.equal(src.src,`https://drive.google.com/file/d/${id}/preview`);assert.equal(src.original,url);
}
assert.match(photoSource(`https://drive.google.com/file/d/${id}/view?resourcekey=0-test&usp=sharing`).src,/preview\?resourcekey=0-test$/);
assert.equal(photoSource('https://cdn.example.test/photo.png').kind,'image');
assert.equal(photoSource('https://drive.google.com.evil.test/photo.jpg').kind,'image');
assert.equal(photoSource('https://cdn.example.test/drive.google.com/file/d/x').kind,'image');
for(const url of['javascript:alert(1)','data:image/svg+xml;base64,xxx','http://example.test/photo.jpg','https://user:password@example.test/photo.jpg','https://drive.google.com/drive/folders/folder','https://drive.google.com/open?id=%22%3E','not a URL',''])assert.throws(()=>photoSource(url));
assert.equal(formatEntryDate('2026-11-26T02:30:00.000Z'),'25/11/2026');
assert.equal(formatEntryDate('2026-11-26T04:00:00.000Z'),'26/11/2026');
assert.equal(formatEntryDate('2026-11-26T02:30:00-04:00'),'26/11/2026');
assert.equal(formatEntryDate('2026-11-26'),'26/11/2026');
assert.equal(formatEntryDate('2026-02-30'),'—');
assert.equal(formatEntryDate('invalid'),'—');assert.equal(formatEntryDate(null),'—');assert.equal(formatEntryDate(''),'—');
console.log('PASS: data de entrada Manaus, limites de dia e datas inválidas; fontes HTTPS seguras e preview Drive preservando resourcekey, sem proxy nem alteração de permissões.');
