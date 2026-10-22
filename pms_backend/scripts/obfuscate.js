const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('node:fs');
const path = require('node:path');

const obfuscatorOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.8,
    unicodeEscapeSequence: false
};

function obfuscateDirectory(dirPath) {
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            obfuscateDirectory(fullPath);
        } else if (file.endsWith('.js')) {
            const sourceCode = fs.readFileSync(fullPath, 'utf8');
            const obfuscatedResult = JavaScriptObfuscator.obfuscate(sourceCode, obfuscatorOptions);
            fs.writeFileSync(fullPath, obfuscatedResult.getObfuscatedCode(), 'utf8');
            console.log(`[Ofuscado] ${fullPath}`);
        }
    });
}

const distPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
if (fs.existsSync(distPath)) {
    obfuscateDirectory(distPath);
    console.log('Ofuscación completada exitosamente.');
} else {
    console.log('No se encontró el directorio dist.');
}
