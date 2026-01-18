const YF = require('yahoo-finance2').default; try { const yf = new YF(); console.log('Instantiated'); } catch(e) { console.log('Error instantiating:', e.message); }
