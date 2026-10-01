// Build artifact staging, not source generation. Docker performs the same copies.
import {copyFile} from 'node:fs/promises';
for(const file of ['react-app.js','react-app.css'])await copyFile(new URL('dist/'+file,import.meta.url),new URL('../web/'+file,import.meta.url));
for(const file of ['index.html','login.html','security.html'])await copyFile(new URL('dist/index.html',import.meta.url),new URL('../web/'+file,import.meta.url));
console.log('React build staged for the existing Python server.');
