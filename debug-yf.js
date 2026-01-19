const yfModule = require('yahoo-finance2');
console.log('Keys:', Object.keys(yfModule));
console.log('Default:', yfModule.default);
try {
    console.log('Default keys:', Object.keys(yfModule.default));
} catch (e) {}
