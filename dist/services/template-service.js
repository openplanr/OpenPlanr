import path from 'node:path';
import Handlebars from 'handlebars';
import { getTemplatesDir } from '../utils/constants.js';
import { fileExists, readFile } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
const compiledCache = new Map();
Handlebars.registerHelper('date', () => new Date().toISOString().split('T')[0]);
Handlebars.registerHelper('uppercase', (str) => typeof str === 'string' ? str.toUpperCase() : '');
Handlebars.registerHelper('checkboxList', (items) => {
    if (!Array.isArray(items))
        return '';
    return items.map((item) => `- [ ] ${item}`).join('\n');
});
Handlebars.registerHelper('join', (arr, sep) => Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : '');
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('length', (arr) => (Array.isArray(arr) ? arr.length : 0));
/** Compile and render a Handlebars template, checking the override directory first. */
export async function renderTemplate(templatePath, data, // Template data is inherently untyped
overrideDir) {
    const fullPath = await resolveTemplatePath(templatePath, overrideDir);
    let compiled = compiledCache.get(fullPath);
    if (!compiled) {
        logger.debug(`Compiling template: ${fullPath}`);
        const raw = await readFile(fullPath);
        compiled = Handlebars.compile(raw, { noEscape: true });
        compiledCache.set(fullPath, compiled);
    }
    else {
        logger.debug(`Using cached template: ${fullPath}`);
    }
    return compiled(data);
}
async function resolveTemplatePath(templatePath, overrideDir) {
    if (overrideDir) {
        const overrideFull = path.join(overrideDir, templatePath);
        if (await fileExists(overrideFull)) {
            return overrideFull;
        }
    }
    return path.join(getTemplatesDir(), templatePath);
}
//# sourceMappingURL=template-service.js.map